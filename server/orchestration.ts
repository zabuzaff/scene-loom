import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  missingEvidence,
  nameKey,
  orchestrationState,
  overlayResolutions,
  type EffectiveEntry,
  type OrchestrationAction,
  type OrchestrationRecord,
} from '../shared/orchestration.js';
import { sameModel } from '../shared/rehearsal.js';
import type { ProjectData, SceneData } from '../shared/schema.js';
import { readSelectedAcceptances, sourceIsAccepted } from './foundry.js';
import { fail, StudioError } from './store.js';

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

export type WorkflowAction = OrchestrationAction;
export type WorkflowStatus = {
  // true when entries were read from Foundry just now, false when they are
  // the last recorded snapshot because Foundry could not be read.
  live: boolean;
  readAt: string;
  reason?: string;
  // true only when Foundry itself could not be reached or read.
  unreachable?: boolean;
  libraryId?: string;
  entries: EffectiveEntry[];
  recorded: EffectiveEntry[];
  drifted: boolean;
  current: boolean;
  next: OrchestrationAction | 'resolve';
  action: WorkflowAction;
};

// The authoritative answer to "what does this scene need next". Foundry's
// current acceptance wins over the stored snapshot, which stays as evidence.
// When Foundry cannot be read the answer degrades to the snapshot and says
// so; it never throws and never blocks the owner.
export async function workflowStatus(
  project: ProjectData,
  scene: SceneData,
): Promise<WorkflowStatus> {
  const inputRevision =
    project.rehearsalInputRevision ?? project.contentRevision;
  const state = orchestrationState(scene.rehearsalEvents, inputRevision);
  const base = {
    readAt: new Date().toISOString(),
    recorded: state.entries,
    current: state.current,
  };
  const settle = (next: WorkflowStatus['next']) =>
    ({
      ...base,
      next,
      action: next === 'resolve' ? 'sync' : next,
    }) as const;
  let preview;
  try {
    preview = await acceptancePreview(project, scene);
  } catch (error) {
    const unreachable =
      !(error instanceof StudioError) || error.code === 'FOUNDRY_UNAVAILABLE';
    const reason = unreachable
      ? 'Mesh Foundry could not be read, so this shows the last recorded state.'
      : (error as StudioError).message;
    return {
      ...settle(state.next),
      live: false,
      unreachable,
      reason,
      entries: state.entries,
      drifted: false,
      libraryId: state.sync?.libraryId,
    };
  }
  const entries = overlayResolutions(
    preview.entries,
    state.resolutions,
    undefined,
  );
  const drifted =
    !!state.sync &&
    state.current &&
    (preview.libraryId !== state.sync.libraryId ||
      !isDeepStrictEqual(entries, state.entries));
  const next = !state.sync || !state.current || drifted ? 'sync' : state.next;
  return {
    ...settle(next),
    live: true,
    entries,
    drifted,
    libraryId: preview.libraryId,
  };
}

// An owner-initiated card action meets current state. An action that still
// matches is confirmed; otherwise the response carries the current action so
// the card can refresh and offer it. Nothing is applied from here.
export async function checkCardAction(
  project: ProjectData,
  scene: SceneData,
  requested: string,
) {
  const status = await workflowStatus(project, scene);
  const base = { requested, contentRevision: project.contentRevision };
  // Without a live read nothing is verified: say so, and let the owner copy
  // the prompt anyway.
  if (!status.live)
    return {
      ...base,
      ...status,
      status: 'unverified' as const,
      reason: status.reason ?? 'The current state could not be verified.',
    };
  const matches =
    requested === status.action ||
    (requested === 'review-game' && status.action === 'handoff');
  return {
    ...base,
    ...status,
    status: matches ? ('current' as const) : ('changed' as const),
  };
}

const draftRead = z.object({
  digest: z.string(),
  scene: z.object({
    version: z.literal(3),
    plan: z.object({ storyboardId: z.string(), sceneId: z.string() }),
    scenarios: z.array(z.object({ id: z.string() })),
  }),
});

// Rehearsal publishes its address in runtime.json; read only the URL.
export async function rehearsalOrigin() {
  if (process.env.SCENE_LOOM_REHEARSAL_URL)
    return process.env.SCENE_LOOM_REHEARSAL_URL;
  const dir =
    process.env.SCENE_REHEARSAL_DATA_DIR ??
    join(homedir(), 'Library/Application Support/Scene Rehearsal');
  const { url } = z
    .object({ url: z.string() })
    .parse(JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8')));
  return url;
}

export async function validateOrchestration(
  project: ProjectData,
  scene: SceneData,
  event: OrchestrationRecord,
) {
  const events = scene.rehearsalEvents ?? [];
  const inputRevision =
    project.rehearsalInputRevision ?? project.contentRevision;
  const state = orchestrationState(events, inputRevision);
  const { sync, plan, next } = state;
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
  if (record.stage === 'owner-resolution') {
    requireCurrent(
      sync && next !== 'sync' && record.syncId === sync.eventId,
      'Sync the scene assets first; the resolution must cite the current manifest.',
    );
    const target = sync.entries.filter(
      (entry) => nameKey(entry.name) === nameKey(record.name),
    );
    requireCurrent(
      target.length === 1 &&
        target[0].required &&
        !target[0].source &&
        isDeepStrictEqual(record.prior, target[0]),
      'Name one required selection from the current manifest that has no accepted source, with its recorded state.',
    );
    // A pinned source needs live proof; with Foundry unreachable only a
    // waiver (no source) may be recorded. A newer resolution supersedes an
    // older one for the same name in this sync.
    if (record.source) {
      requireCurrent(
        record.source.libraryId === sync.libraryId,
        'The source must be in the linked library.',
      );
      const accepted = await sourceIsAccepted(record.source).catch(() =>
        fail(
          'FOUNDRY_UNAVAILABLE',
          'Foundry could not be read, so only a waiver without a source can be recorded.',
          503,
        ),
      );
      requireCurrent(
        accepted,
        'That revision is not currently accepted in the linked Foundry library.',
      );
    }
    return;
  }
  requireCurrent(
    next !== 'resolve' && next !== 'sync' && sync,
    'Sync all required scene assets first.',
  );
  if (record.stage === 'plan' || record.stage === 'draft') {
    const preview = await acceptancePreview(project, scene);
    if (
      preview.libraryId !== sync.libraryId ||
      !isDeepStrictEqual(
        overlayResolutions(preview.entries, state.resolutions, undefined),
        state.entries,
      )
    )
      fail(
        'STALE_FOUNDRY',
        'Foundry acceptance changed. Reconcile the accepted-asset manifest before continuing.',
        409,
      );
  }
  if (
    record.stage === 'decision' ||
    record.stage === 'publication' ||
    record.stage === 'draft-review'
  )
    fail(
      'LEGACY_STAGE',
      'Plan approval, publication and draft review are retired. Save the plan, then a draft record once Rehearsal holds the draft.',
      409,
    );
  if (record.stage === 'game-review') {
    requireCurrent(
      state.draft && record.draftId === state.draftId,
      'Record the review against the scene’s current Rehearsal draft.',
    );
    const missing = missingEvidence(record.evidence);
    if (record.verdict === 'ready' && missing.length)
      fail(
        'REVIEW_EVIDENCE_REQUIRED',
        `A ready game review needs non-empty evidence for every category. Missing: ${missing.join(', ')}.`,
        422,
        'Add evidence.propCaptures [{piece, captureRef}], evidence.scaleChecks [{piece, against, result}] and evidence.clipChecks [{piece, clip, action, result}], or record changes-requested with findings.',
      );
    return;
  }
  if (record.stage === 'plan') {
    requireCurrent(
      record.syncId === sync.eventId,
      'The proposal must target the current manifest.',
    );
    const { pieces } = record.plan;
    requireCurrent(
      new Set(pieces.map((piece) => piece.id)).size === pieces.length &&
        pieces.every(
          (piece) =>
            piece.size.every((value) => value > 0 && value <= 100) &&
            piece.scale.every((value) => value > 0) &&
            (!piece.source ||
              state.entries.some((entry) =>
                sameModel(entry.source, piece.source!),
              )),
        ) &&
        state.entries.every(
          (entry) =>
            !entry.required ||
            (entry.ownerResolved && !entry.source) ||
            pieces.some(
              (piece) => piece.source && sameModel(entry.source, piece.source),
            ),
        ),
      'Use unique piece IDs, valid proxy dimensions and the exact synced revisions for required assets.',
    );
    return;
  }
  requireCurrent(plan, 'A current plan is required.');
  const origin = await rehearsalOrigin().catch(() =>
    fail(
      'REHEARSAL_UNAVAILABLE',
      'Scene Rehearsal is not running. Start it with its CLI, then retry.',
      503,
    ),
  );
  const read = async (path: string) => {
    const response = await fetch(origin + path, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Rehearsal read failed.');
    return response.json();
  };
  const checked = await Promise.all([
    read(`/api/revision/${record.draftId}`).then((value) =>
      draftRead.parse(value),
    ),
    read('/api/library').then((value) =>
      z
        .object({
          drafts: z.array(z.object({ key: z.string(), digest: z.string() })),
        })
        .parse(value),
    ),
  ]).catch(() =>
    fail(
      'REHEARSAL_UNAVAILABLE',
      'Could not read the draft from Scene Rehearsal.',
      503,
    ),
  );
  const [found, library] = checked;
  requireCurrent(
    record.url === origin &&
      found.digest === record.draftId &&
      found.scene.plan.storyboardId === project.id &&
      found.scene.plan.sceneId === scene.id &&
      found.scene.scenarios.some(({ id }) => id === record.scenarioId) &&
      library.drafts.some(
        ({ key, digest }) =>
          key === `${project.id}/${scene.id}` && digest === record.draftId,
      ),
    'Record the live Rehearsal draft for this exact storyboard scene and one of its scenarios.',
  );
}
