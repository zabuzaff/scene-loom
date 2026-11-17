import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { ManifestEntry } from '../shared/orchestration.js';
import type { SceneData } from '../shared/schema.js';
import type { Model } from '../shared/rehearsal.js';

const runtimeSchema = z.object({
  url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  token: z.string().min(1),
});
const librarySchema = z.object({
  id: z.string(),
  assets: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  accepted: z.record(z.string(), z.string()),
  acceptance: z.array(
    z.object({
      revisionId: z.string(),
      previousRevisionId: z.string().optional(),
    }),
  ),
  revisions: z.array(
    z.object({
      id: z.string(),
      assetId: z.string(),
      stage: z.enum(['sketch', 'study', 'model']),
      fixture: z.boolean(),
      files: z.array(z.object({ kind: z.string() })).default([]),
    }),
  ),
});

async function readLibrary(libraryId: string) {
  const root =
    process.env.MESH_FOUNDRY_DATA_DIR ??
    join(homedir(), 'Library/Application Support/Mesh Foundry');
  if (!isAbsolute(root))
    throw new Error('Expected an absolute Foundry data directory.');
  const runtime = runtimeSchema.parse(
    JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8')),
  );
  const response = await fetch(
    runtime.url + '/agent/projects/' + encodeURIComponent(libraryId),
    {
      headers: { Authorization: `Bearer ${runtime.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error('Foundry library read failed.');
  const library = librarySchema.parse(await response.json());
  if (library.id !== libraryId)
    throw new Error('Foundry library identity mismatch.');
  return library;
}

export async function verifyFoundryAcceptance(model: Model) {
  return accepts(await readLibrary(model.libraryId), model);
}

function accepts(
  library: z.infer<typeof librarySchema>,
  model: Model,
  stage: 'study' | 'model' = 'model',
) {
  const models = library.revisions.filter(
    (revision) =>
      revision.assetId === model.assetId && revision.stage === stage,
  );
  if (
    !models.some(
      (revision) => revision.id === model.revisionId && !revision.fixture,
    )
  )
    return false;
  // Match Foundry's model-stage approval precedence, including legacy pointers.
  const ids = new Set(models.map(({ id }) => id));
  const pointer = library.accepted[model.assetId];
  if (ids.has(pointer)) return pointer === model.revisionId;
  const history = [...library.acceptance].reverse();
  const current = history.find(({ revisionId }) => ids.has(revisionId));
  if (current) return current.revisionId === model.revisionId;
  return (
    history.find(
      ({ previousRevisionId }) =>
        previousRevisionId !== undefined && ids.has(previousRevisionId),
    )?.previousRevisionId === model.revisionId
  );
}

export async function readSelectedAcceptances(
  scene: SceneData,
  libraryId: string,
  previous: z.infer<typeof ManifestEntry>[] = [],
) {
  const library = await readLibrary(libraryId);
  const selected =
    scene.selectedAssets ??
    (scene.rehearsalBrief?.assets ?? [])
      .filter(({ decision }) => decision !== 'leave out')
      .map(({ name, decision, source }) => ({
        name,
        required: decision !== 'optional',
        source,
      }));
  const nameKey = (name: string) => name.trim().toLowerCase();
  return selected.map(({ name, required, source: saved }) => {
    const prior = previous.filter(
      (entry) =>
        nameKey(entry.name) === nameKey(name) &&
        (entry.source || entry.pinnedSource),
    );
    if (
      !saved &&
      (prior.length > 1 ||
        selected.some(
          (entry) =>
            entry.name !== name && nameKey(entry.name) === nameKey(name),
        ) ||
        selected.filter((entry) => entry.name === name).length > 1)
    )
      return {
        name,
        required,
        issue:
          'Duplicate selection name. Save an exact source for this selection.',
      };
    const source =
      saved ??
      (prior.length === 1
        ? (prior[0].pinnedSource ?? prior[0].source)
        : undefined);
    const entry = {
      name,
      required,
      ...(source ? { pinnedSource: source } : {}),
    };
    if (source && source.libraryId !== libraryId)
      return {
        ...entry,
        issue: 'The saved source belongs to another library.',
      };
    const matches = source
      ? library.assets.filter(({ id }) => id === source.assetId)
      : library.assets.filter(
          (asset) =>
            asset.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
    if (matches.length !== 1)
      return {
        ...entry,
        issue: matches.length
          ? 'Multiple assets match this selection.'
          : 'No matching asset in the linked library.',
      };
    const assetId = matches[0].id;
    const models = library.revisions.filter(
      (rev) =>
        rev.assetId === assetId &&
        (rev.stage === 'study' || rev.stage === 'model') &&
        !rev.fixture &&
        rev.files.some(({ kind }) => kind === 'model') &&
        accepts(library, { libraryId, assetId, revisionId: rev.id }, rev.stage),
    );
    if (!source && models.length > 1)
      return {
        ...entry,
        issue:
          'Both a 3D prototype and a developed model are accepted. An exact selection is needed.',
      };
    const revisionId = source?.revisionId ?? models[0]?.id;
    if (!revisionId || !models.some((rev) => rev.id === revisionId))
      return {
        ...entry,
        issue: source
          ? 'The exact saved pin lacks current acceptance at its 3D stage.'
          : 'No eligible owner-accepted 3D revision.',
      };
    return { name, required, source: { libraryId, assetId, revisionId } };
  });
}
