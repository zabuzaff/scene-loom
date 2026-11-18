import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  orchestrationState,
  type OrchestrationRecord,
} from '../shared/orchestration.js';
import { sameModel } from '../shared/rehearsal.js';
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
  const { sync, plan, next } = orchestrationState(events, inputRevision);
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
  if (record.stage === 'plan' || record.stage === 'draft') {
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
