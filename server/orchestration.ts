import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  orchestrationState,
  type OrchestrationRecord,
} from '../shared/orchestration.js';
import { rehearsalState, sameModel } from '../shared/rehearsal.js';
import type { ProjectData, SceneData } from '../shared/schema.js';
import { readSelectedAcceptances } from './foundry.js';
import { fail } from './store.js';

export function linkedLibrary(project: ProjectData, scene: SceneData) {
  const selected =
    scene.selectedAssets ??
    scene.rehearsalBrief?.assets.filter(
      (asset) => asset.decision !== 'leave out',
    ) ??
    [];
  const saved = new Set(
    selected.flatMap((asset) => (asset.source ? [asset.source.libraryId] : [])),
  );
  if (saved.size > 1)
    fail(
      'AMBIGUOUS_LIBRARY',
      'Selected sources point to multiple Foundry libraries.',
      409,
    );
  const owner = project.storyboard?.projectId ?? project.id;
  return (
    [...saved][0] ??
    'scene-loom-' + createHash('sha256').update(owner).digest('hex')
  );
}

export async function acceptancePreview(
  project: ProjectData,
  scene: SceneData,
) {
  if (!scene.selectedAssets && !scene.rehearsalBrief)
    fail(
      'SELECTION_REQUIRED',
      'Save the owner-confirmed selected assets first. Use an empty list for a scene without assets.',
      409,
    );
  const libraryId = linkedLibrary(project, scene);
  const inputRevision =
    project.rehearsalInputRevision ?? project.contentRevision;
  const previous = orchestrationState(
    scene.rehearsalEvents,
    inputRevision,
  ).sync;
  const entries = await readSelectedAcceptances(
    scene,
    libraryId,
    previous?.entries,
  ).catch(() =>
    fail(
      'FOUNDRY_UNAVAILABLE',
      'Could not read the exact linked Foundry library.',
      503,
    ),
  );
  return { libraryId, inputRevision, entries };
}

const draftRead = z.object({
  digest: z.string(),
  parent: z.string().nullable(),
  scene: z.object({
    version: z.literal(3),
    plan: z.object({
      storyboardId: z.string(),
      sceneId: z.string(),
      planId: z.string(),
      planRevision: z.union([z.string(), z.number().int().nonnegative()]),
      approvalId: z.string(),
    }),
    objects: z.array(
      z.object({
        id: z.string(),
        pieces: z.array(z.string()).optional(),
        asset: z.unknown().optional(),
        position: z.array(z.number()),
        size: z.array(z.number()),
        scale: z.array(z.number()),
        rotation: z.array(z.number()),
      }),
    ),
    pendingChecks: z.array(z.string()),
    scenarios: z.array(
      z.object({
        id: z.string(),
        events: z.array(
          z.object({
            intent: z.string(),
            route: z.unknown().optional(),
            camera: z.unknown().optional(),
          }),
        ),
      }),
    ),
  }),
  draftReview: z.object({ checked: z.string() }).optional(),
  approvals: z.array(z.object({ kind: z.string() })),
});

export async function validateOrchestration(
  project: ProjectData,
  scene: SceneData,
  event: OrchestrationRecord,
) {
  const events = scene.rehearsalEvents ?? [];
  const inputRevision =
    project.rehearsalInputRevision ?? project.contentRevision;
  const { sync, plan, decision, draft, next } = orchestrationState(
    events,
    inputRevision,
  );
  const { record } = event;
  function requireCurrent(
    condition: unknown,
    message: string,
  ): asserts condition {
    if (!condition) fail('STALE_REHEARSAL', message, 409);
  }
  requireCurrent(
    !events.some(({ eventId }) => eventId === event.eventId),
    'Use an unused rehearsal event ID.',
  );
  if (record.stage === 'sync') {
    const legacy = events.some((event) => event.kind !== 'orchestration');
    requireCurrent(
      !record.legacyReset || (!sync && legacy),
      'Reset requires active legacy rehearsal evidence.',
    );
    requireCurrent(
      !!record.legacyReset || !!sync || !legacy,
      'Retire the active legacy rehearsal with an explicit reset.',
    );
    const preview = await acceptancePreview(project, scene);
    requireCurrent(
      !sync ||
        next === 'sync' ||
        !isDeepStrictEqual(sync.entries, preview.entries),
      'The accepted manifest is already current.',
    );

    requireCurrent(
      record.inputRevision === preview.inputRevision &&
        record.libraryId === preview.libraryId &&
        isDeepStrictEqual(record.entries, preview.entries),
      'Foundry or scene inputs changed. Read a fresh accepted-asset preview.',
    );
    return;
  }
  requireCurrent(
    next !== 'resolve' && next !== 'sync' && sync,
    'Sync all required scene assets first.',
  );
  if (
    record.stage === 'plan' ||
    record.stage === 'decision' ||
    record.stage === 'publication' ||
    (record.stage === 'draft-review' && record.verdict === 'approved')
  ) {
    const preview = await acceptancePreview(project, scene);
    if (
      preview.libraryId !== sync.libraryId ||
      !isDeepStrictEqual(preview.entries, sync.entries)
    )
      fail(
        'STALE_FOUNDRY',
        'Foundry acceptance changed. Reconcile the accepted-asset manifest before continuing.',
        409,
      );
  }
  if (record.stage === 'plan') {
    requireCurrent(
      next === 'plan' && record.syncId === sync.eventId,
      'The proposal must target the current manifest and address any requested changes.',
    );
    const { pieces } = record.plan;
    requireCurrent(
      new Set(pieces.map((piece) => piece.id)).size === pieces.length &&
        pieces.every(
          (piece) =>
            piece.size.every((value) => value > 0 && value <= 100) &&
            piece.scale.every((value) => value > 0) &&
            (!piece.source ||
              sync.entries.some((entry) =>
                sameModel(entry.source, piece.source!),
              )),
        ) &&
        sync.entries.every(
          (entry) =>
            !entry.required ||
            pieces.some(
              (piece) => piece.source && sameModel(entry.source, piece.source),
            ),
        ),
      'Use unique piece IDs, valid proxy dimensions and the exact synced revisions for required assets.',
    );
    return;
  }
  requireCurrent(plan, 'A current plan is required.');
  if (record.stage === 'decision') {
    requireCurrent(
      next === 'decide' &&
        plan.eventId === record.planId &&
        (record.verdict === 'approved' || record.feedback),
      'Decide on the exact pending proposal and include any requested changes.',
    );
    return;
  }
  requireCurrent(
    decision?.verdict === 'approved',
    'A current owner approval is required.',
  );
  const target = record.stage === 'publication' ? record : draft;
  requireCurrent(target, 'A recorded draft is required.');
  if (record.stage === 'publication') {
    requireCurrent(
      (next === 'publish' || next === 'review-draft' || next === 'handoff') &&
        record.approvalId === decision.eventId &&
        record.revisionId !== record.parent &&
        (!draft ||
          (record.dataDir === draft.dataDir && record.port === draft.port)),
      'Publish under the current approval and recorded Rehearsal library.',
    );
    const legacy = rehearsalState(events).head;
    requireCurrent(
      !legacy ||
        (record.dataDir === legacy.dataDir && record.port === legacy.port),
      'Use the recorded Rehearsal library.',
    );
  } else {
    requireCurrent(
      next === 'review-draft' &&
        record.publicationId === draft?.eventId &&
        [plan.planner, draft.builder].every(
          (author) =>
            author.trim().toLowerCase() !==
            record.reviewer.trim().toLowerCase(),
        ),
      'A fresh independent reviewer must review the exact recorded draft.',
    );
  }
  const tuple = {
    storyboardId: project.id,
    sceneId: scene.id,
    planId: plan.eventId,
    planRevision: plan.eventId,
    approvalId: decision.eventId,
  };
  const actual = await (async () => {
    const read = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${target.port}${path}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Rehearsal read failed.');
      return response.json();
    };
    const actual = draftRead.parse(
      await read(`/api/revision/${target.revisionId}`),
    );
    const library = z
      .object({
        planHeads: z.array(
          z.object({
            plan: draftRead.shape.scene.shape.plan,
            digest: z.string(),
          }),
        ),
      })
      .parse(await read('/api/library'));
    const head = library.planHeads.find((entry) =>
      isDeepStrictEqual(entry.plan, tuple),
    )?.digest;
    const recorded = draft?.revisionId ?? null;
    let ancestor = actual.parent;
    if (
      record.stage === 'publication' &&
      head === target.revisionId &&
      actual.parent === target.parent
    ) {
      const seen = new Set([target.revisionId]);
      while (
        ancestor !== recorded &&
        ancestor &&
        /^[a-f0-9]{64}$/.test(ancestor) &&
        !seen.has(ancestor) &&
        seen.size <= 16
      ) {
        seen.add(ancestor);
        const revision = draftRead.parse(
          await read(`/api/revision/${ancestor}`),
        );
        if (
          revision.digest !== ancestor ||
          !isDeepStrictEqual(revision.scene.plan, tuple)
        )
          break;
        ancestor = revision.parent;
      }
    }
    return { actual, head, reconciled: ancestor === recorded };
  })().catch(() =>
    fail(
      'REHEARSAL_UNAVAILABLE',
      'Could not verify the exact Rehearsal revision and plan head.',
      503,
    ),
  );
  const { actual: checked, head, reconciled } = actual;
  const cueRecords = checked.scene.scenarios.flatMap(
    (scenario) => scenario.events,
  );
  const planPieceIds = new Set(plan.plan.pieces.map((piece) => piece.id));
  const representedIds = checked.scene.objects.flatMap(
    (object) => object.pieces ?? [object.id],
  );
  requireCurrent(
    (record.stage !== 'publication' || reconciled) &&
      head === target.revisionId &&
      checked.digest === target.revisionId &&
      checked.parent === target.parent &&
      isDeepStrictEqual(checked.scene.plan, tuple) &&
      checked.scene.scenarios.some(({ id }) => id === target.scenarioId) &&
      checked.scene.objects.every(({ asset }) => !asset) &&
      representedIds.length === planPieceIds.size &&
      new Set(representedIds).size === planPieceIds.size &&
      representedIds.every((id) => planPieceIds.has(id)) &&
      plan.plan.checks.every((check) =>
        checked.scene.pendingChecks.includes(check),
      ) &&
      plan.plan.cameraOrTraversal.every((cue) =>
        cueRecords.some(
          (record) => record.intent === cue && (record.route || record.camera),
        ),
      ) &&
      plan.plan.pieces.every((piece) =>
        cueRecords.some((record) => record.intent === piece.behavior),
      ) &&
      plan.plan.pieces.every((piece) =>
        checked.scene.objects.some(
          (object) =>
            (object.id === piece.id || object.pieces?.includes(piece.id)) &&
            (['position', 'size', 'scale', 'rotation'] as const).every((key) =>
              isDeepStrictEqual(object[key], piece[key]),
            ),
        ),
      ),
    'The published placeholder draft must match this approved plan, scenario and piece transforms.',
  );
  if (record.stage === 'draft-review' && record.verdict === 'approved')
    requireCurrent(
      checked.approvals.some(({ kind }) => kind === 'final') &&
        checked.draftReview &&
        record.findings.includes(checked.draftReview.checked),
      'Record the exact published draft approval and its checked evidence from Rehearsal.',
    );
}
