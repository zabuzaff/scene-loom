import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readSelectedAcceptances,
  verifyFoundryAcceptance,
} from '../server/foundry.js';

test('owner acceptance must cover the exact eligible Foundry revision', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'loom-foundry-'));
  const previousRoot = process.env.MESH_FOUNDRY_DATA_DIR;
  process.env.MESH_FOUNDRY_DATA_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.MESH_FOUNDRY_DATA_DIR;
    else process.env.MESH_FOUNDRY_DATA_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });
  const url = 'http://127.0.0.1:4323';
  await writeFile(
    join(root, 'runtime.json'),
    JSON.stringify({ url, token: 'fixture' }),
  );

  const model = { libraryId: 'library', assetId: 'desk', revisionId: 'first' };
  const first = {
    id: 'first',
    assetId: 'desk',
    stage: 'model',
    fixture: false,
    files: [{ kind: 'model' }],
  };
  const library = {
    id: 'library',
    assets: [{ id: 'desk', name: 'Desk' }],
    accepted: { desk: 'second' },
    acceptance: [{ revisionId: 'first' }, { revisionId: 'second' }],
    revisions: [
      first,
      { ...first, id: 'second' },
      { ...first, id: 'study', stage: 'study' },
    ],
  };
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, options: RequestInit) => {
      assert.equal(input, url + '/agent/projects/library');
      assert.deepEqual(options.headers, { Authorization: 'Bearer fixture' });
      assert.equal(options.redirect, 'error');
      return Response.json(library);
    },
  );
  assert.equal(await verifyFoundryAcceptance(model), false);
  library.accepted.desk = 'study';
  assert.equal(await verifyFoundryAcceptance(model), false);
  library.accepted.desk = 'first';
  assert.equal(await verifyFoundryAcceptance(model), true);
  first.fixture = true;
  assert.equal(await verifyFoundryAcceptance(model), false);
  first.fixture = false;
  const scene = {
    id: 'room',
    title: 'Room',
    notes: '',
    description: '',
    supportingAssetIds: [],
    selectedAssets: [{ name: 'Desk', required: true }],
  };
  const verified = await readSelectedAcceptances(scene, 'library');
  assert.deepEqual(verified[0].source, model);
  library.accepted.desk = 'second';
  const gap = await readSelectedAcceptances(scene, 'library', verified);
  assert.equal(gap[0].source, undefined);
  assert.deepEqual(gap[0].pinnedSource, model);
  assert.deepEqual(await readSelectedAcceptances(scene, 'library', gap), gap);
  const duplicates = {
    ...scene,
    selectedAssets: [
      ...scene.selectedAssets,
      { name: ' desk ', required: true },
    ],
  };
  const ambiguous = await readSelectedAcceptances(
    duplicates,
    'library',
    verified,
  );
  assert.ok(
    ambiguous.every(
      (entry) => !entry.source && /Duplicate selection/.test(entry.issue ?? ''),
    ),
  );
});
