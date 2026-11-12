import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { Store, StudioError } from '../server/store.js';
import { createApp } from '../server/app.js';
import type { BatchData } from '../shared/schema.js';
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'scene-loom-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = join(root, 'valid.png');
  await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#384a40' },
  })
    .png()
    .toFile(image);
  const store = new Store(root);
  await store.create({ id: 'test', title: 'Test world' });
  const asset = await store.importAsset('test', image);
  const scene = (id: string) => ({
    id,
    title: id,
    description: 'A real moment.',
    notes: '',
    mainAssetId: asset.id,
    supportingAssetIds: [],
  });
  const batch = (
    operations: BatchData['operations'],
    revision = 0,
    requestId = 'request_1',
  ): BatchData => ({
    schemaVersion: 1,
    projectId: 'test',
    expectedContentRevision: revision,
    requestId,
    operations,
  });
  return { root, image, store, asset, scene, batch };
}
const hasCode = (code: string) => (e: unknown) =>
  e instanceof StudioError && e.code === code;
test('image imports fully decode and own originals; invalid/missing/animated input never publishes', async (t) => {
  const { root, store, asset } = await fixture(t);
  assert.equal(asset.width, 64);
  assert.equal((await store.read('test')).contentRevision, 0);
  assert.ok(
    (await readFile(join(root, 'projects/test/assets', `${asset.id}.source`)))
      .length,
  );
  await assert.rejects(
    store.importAsset('test', join(root, 'missing.png')),
    hasCode('INVALID_ASSET'),
  );
  const corrupt = join(root, 'broken.png');
  await writeFile(corrupt, Buffer.from('not an image'));
  await assert.rejects(
    store.importAsset('test', corrupt),
    hasCode('INVALID_ASSET'),
  );
  assert.equal(Object.keys((await store.read('test')).assets).length, 1);
});
test('atomic graph batches support branches, joins, cycles and self-loops; retries are durable', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  const ops: BatchData['operations'] = ['a', 'b', 'c', 'd'].map((id) => ({
    type: 'scene.create',
    scene: scene(id),
  }));
  for (const [id, source, target] of [
    ['ab', 'a', 'b'],
    ['ac', 'a', 'c'],
    ['bd', 'b', 'd'],
    ['cd', 'c', 'd'],
    ['da', 'd', 'a'],
    ['aa', 'a', 'a'],
  ])
    ops.push({
      type: 'connection.create',
      connection: { id, sourceSceneId: source, targetSceneId: target },
    });
  const input = batch(ops),
    result = await store.apply(input);
  assert.equal(result.contentRevision, 1);
  assert.deepEqual(await new Store(root).apply(input), result);
  assert.equal((await store.read('test')).scenes.length, 4);
  await assert.rejects(
    store.apply({
      ...input,
      operations: [{ type: 'scene.create', scene: scene('other') }],
    }),
    hasCode('REQUEST_ID_REUSED'),
  );
  await assert.rejects(
    store.apply(batch([{ type: 'scene.delete', id: 'a' }], 1, 'bad_delete')),
    hasCode('DANGLING_CONNECTION'),
  );
  assert.equal((await store.read('test')).contentRevision, 1);
  await assert.rejects(
    store.apply(
      batch(
        [
          { type: 'scene.patch', id: 'a', changes: { title: 'Changed' } },
          {
            type: 'connection.create',
            connection: {
              id: 'bad',
              sourceSceneId: 'a',
              targetSceneId: 'missing',
            },
          },
        ],
        1,
        'bad_graph',
      ),
    ),
    hasCode('DANGLING_CONNECTION'),
  );
  assert.equal((await store.read('test')).scenes[0].title, 'a');
  await assert.rejects(
    store.apply(
      batch([{ type: 'scene.create', scene: scene('a') }], 1, 'duplicate'),
    ),
    hasCode('DUPLICATE_ID'),
  );
});
test('dry runs and stale revisions preserve bytes; unknown image references fail', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  const file = join(root, 'projects/test/project.json'),
    before = await readFile(file, 'utf8');
  await store.apply(batch([{ type: 'scene.create', scene: scene('a') }]), true);
  assert.equal(await readFile(file, 'utf8'), before);
  await assert.rejects(
    store.apply(
      batch([
        {
          type: 'scene.create',
          scene: { ...scene('a'), mainAssetId: 'missing' },
        },
      ]),
    ),
    hasCode('MISSING_ASSET'),
  );
  assert.equal(await readFile(file, 'utf8'), before);
  await store.apply(batch([{ type: 'scene.create', scene: scene('a') }]));
  await assert.rejects(
    store.apply(
      batch(
        [{ type: 'scene.patch', id: 'a', changes: { notes: 'stale' } }],
        0,
        'stale',
      ),
    ),
    hasCode('CONTENT_CONFLICT'),
  );
  await assert.rejects(
    store.apply({
      ...batch([{ type: 'scene.create', scene: scene('b') }], 1, 'unknown'),
      unexpected: true,
    }),
  );
});
test('text-only scenes persist, accept a verified image later and can clear it without moving the card', async (t) => {
  const { store, asset, scene, batch, root } = await fixture(t);
  const planned = { ...scene('plan'), mainAssetId: undefined };
  await store.apply(batch([{ type: 'scene.create', scene: planned }]));
  const initial = await new Store(root).read('test');
  assert.equal(initial.scenes[0].mainAssetId, undefined);
  await store.apply(
    batch(
      [{ type: 'scene.patch', id: 'plan', changes: { mainAssetId: asset.id } }],
      1,
      'attach',
    ),
  );
  const illustrated = await store.read('test');
  assert.equal(illustrated.scenes[0].mainAssetId, asset.id);
  assert.deepEqual(illustrated.positions, initial.positions);
  await store.apply(
    batch(
      [{ type: 'scene.patch', id: 'plan', changes: { mainAssetId: null } }],
      2,
      'clear',
    ),
  );
  assert.equal(
    (await new Store(root).read('test')).scenes[0].mainAssetId,
    null,
  );
});
test('serialized content changes and layout patches preserve both; restore advances both revisions', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  await store.apply(batch([{ type: 'scene.create', scene: scene('a') }]));
  await Promise.all([
    store.layout('test', {
      expectedLayoutRevision: 0,
      positions: { a: { x: 170, y: 230 } },
    }),
    store.apply(
      batch(
        [{ type: 'scene.patch', id: 'a', changes: { notes: 'new notes' } }],
        1,
        'edit',
      ),
    ),
  ]);
  const p = await new Store(root).read('test');
  assert.deepEqual(p.positions.a, { x: 170, y: 230 });
  assert.equal(p.scenes[0].notes, 'new notes');
  await assert.rejects(
    store.layout('test', {
      expectedLayoutRevision: 0,
      positions: { a: { x: 0, y: 0 } },
    }),
    hasCode('LAYOUT_CONFLICT'),
  );
  await store.viewport('test', { x: 20, y: 30, zoom: 0.6 });
  assert.deepEqual(await new Store(root).viewport('test'), {
    x: 20,
    y: 30,
    zoom: 0.6,
  });
  await store.settings('test', { meshFoundryEnabled: true });
  assert.deepEqual(await new Store(root).read('test'), {
    ...p,
    meshFoundryEnabled: true,
  });
  const backups = await store.backups('test');
  assert.equal(backups.length, 2);
  await assert.rejects(
    store.restore('test', {
      backupId: backups[0],
      expectedContentRevision: p.contentRevision,
      expectedLayoutRevision: 0,
    }),
    hasCode('RESTORE_CONFLICT'),
  );
  const restored = await store.restore('test', {
    backupId: backups[0],
    expectedContentRevision: p.contentRevision,
    expectedLayoutRevision: p.layoutRevision,
  });
  assert.equal(restored.scenes[0].notes, '');
  assert.equal(restored.contentRevision, 3);
  assert.equal(restored.layoutRevision, 2);
  assert.equal(restored.meshFoundryEnabled, true);
  assert.deepEqual(restored.positions.a, { x: 170, y: 230 });
});
test('retention bounds snapshots and allows explicit scene+connection removal', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  await store.apply(
    batch([
      { type: 'scene.create', scene: scene('a') },
      {
        type: 'connection.create',
        connection: { id: 'aa', sourceSceneId: 'a', targetSceneId: 'a' },
      },
    ]),
  );
  for (let i = 1; i < 23; i++)
    await store.apply(
      batch(
        [{ type: 'scene.patch', id: 'a', changes: { notes: String(i) } }],
        i,
        `edit_${i}`,
      ),
    );
  assert.equal((await store.backups('test')).length, 20);
  await store.apply(
    batch(
      [
        { type: 'scene.delete', id: 'a' },
        { type: 'connection.delete', id: 'aa' },
      ],
      23,
      'delete',
    ),
  );
  assert.equal((await store.read('test')).scenes.length, 0);
  assert.equal((await readdir(join(root, 'projects/test/assets'))).length, 2);
});
test('service restricts host, origin, session and browser local-file imports', async (t) => {
  const { root, image } = await fixture(t);
  const { app, token } = await createApp({ root, serve: false });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:4318', authorization: `Bearer ${token}` };
  assert.equal(
    (await app.inject({ url: '/api/projects', headers })).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/projects',
        headers: { host: 'evil.test:4318', authorization: `Bearer ${token}` },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/session',
        headers: { host: '127.0.0.1:4318', origin: 'https://evil.test' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/projects',
        headers: { host: '127.0.0.1:4318' },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/projects/test/assets',
        method: 'POST',
        headers: { ...headers, origin: 'http://127.0.0.1:4318' },
        payload: { path: image },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/projects/test/assets',
        method: 'POST',
        headers,
        payload: { path: image },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: '/api/schema/batch', headers })).statusCode,
    200,
  );
  const session = await app.inject({
    url: '/api/session',
    headers: { host: '127.0.0.1:4318' },
  });
  assert.match(
    session.headers['set-cookie'] as string,
    /HttpOnly; SameSite=Strict/,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/projects/test/apply',
        method: 'POST',
        headers,
        payload: { projectId: 'wrong' },
      })
    ).statusCode,
    400,
  );
});

test('automatic placement stays readable for large batches and edge anchors', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  await store.apply(
    batch(
      Array.from({ length: 230 }, (_, i) => ({
        type: 'scene.create' as const,
        scene: scene(`s_${i}`),
      })),
    ),
  );
  assert.equal((await new Store(root).read('test')).scenes.length, 230);
  await store.layout('test', {
    expectedLayoutRevision: 0,
    positions: { s_0: { x: 99999, y: 99999 } },
  });
  await store.apply(
    batch(
      [
        {
          type: 'scene.create',
          scene: scene('edge'),
          placement: { nearSceneId: 's_0' },
        },
      ],
      1,
      'near_edge',
    ),
  );
  const p = await new Store(root).read('test');
  assert.ok(p.positions.edge.x <= 100000 && p.positions.edge.y <= 100000);
});
test('corrupt-state recovery lists backups and preserves damaged bytes before restoring', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  await store.apply(batch([{ type: 'scene.create', scene: scene('a') }]));
  await store.apply(
    batch(
      [{ type: 'scene.patch', id: 'a', changes: { notes: 'changed' } }],
      1,
      'edit',
    ),
  );
  const backups = await store.backups('test');
  const file = join(root, 'projects/test/project.json');
  await writeFile(file, 'broken project bytes');
  assert.deepEqual(await store.backups('test'), backups);
  await assert.rejects(store.read('test'), hasCode('CORRUPT_PROJECT'));
  const restored = await store.restore('test', {
    backupId: backups[0],
    recoverCorrupt: true,
  });
  assert.equal(restored.scenes[0].notes, '');
  assert.ok(restored.contentRevision > 2);
  const recovery = await readdir(join(root, 'projects/test/recovery'));
  assert.equal(
    await readFile(join(root, 'projects/test/recovery', recovery[0]), 'utf8'),
    'broken project bytes',
  );
  await assert.rejects(
    store.restore('test', { backupId: backups[0], recoverCorrupt: true }),
    hasCode('RESTORE_CONFLICT'),
  );
});

test('null documents and malformed receipts are classified as corrupt and recoverable', async (t) => {
  const { store, scene, batch, root } = await fixture(t);
  await store.apply(batch([{ type: 'scene.create', scene: scene('a') }]));
  const file = join(root, 'projects/test/project.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  const backup = (await store.backups('test'))[0];
  const cases = [
    null,
    [],
    { ...original, receipts: null },
    { ...original, receipts: {} },
    { ...original, receipts: [null] },
    { ...original, receipts: [{ id: 'bad', hash: 'invalid', result: {} }] },
  ];
  for (const damaged of cases) {
    const bytes = JSON.stringify(damaged);
    await writeFile(file, bytes);
    await assert.rejects(store.read('test'), hasCode('CORRUPT_PROJECT'));
    await assert.rejects(
      store.apply(
        batch(
          [
            {
              type: 'scene.patch',
              id: 'a',
              changes: { notes: 'never applied' },
            },
          ],
          1,
          'invalid_state',
        ),
      ),
      hasCode('CORRUPT_PROJECT'),
    );
    const restored = await store.restore('test', {
      backupId: backup,
      recoverCorrupt: true,
    });
    assert.equal(restored.id, 'test');
    assert.ok(restored.contentRevision > 1);
    const copies = await readdir(join(root, 'projects/test/recovery'));
    const retained = await Promise.all(
      copies.map((name) =>
        readFile(join(root, 'projects/test/recovery', name), 'utf8'),
      ),
    );
    assert.ok(retained.includes(bytes));
    await store.apply(
      batch(
        [{ type: 'scene.create', scene: scene('after_recovery') }],
        restored.contentRevision,
        `recovered_${copies.length}`,
      ),
    );
  }
  const legacy = { ...original };
  delete legacy.receipts;
  await writeFile(file, JSON.stringify(legacy));
  assert.equal((await store.read('test')).id, 'test');
});

test('library listing exposes damaged projects without hiding healthy projects', async (t) => {
  const { store, root } = await fixture(t);
  await store.create({ id: 'broken', title: 'Broken project' });
  const file = join(root, 'projects/broken/project.json');
  const { app, token } = await createApp({ root, serve: false });
  t.after(() => app.close());
  for (const bytes of ['{', 'null']) {
    await writeFile(file, bytes);
    const response = await app.inject({
      url: '/api/projects',
      headers: { host: '127.0.0.1:4318', authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200);
    const summaries = response.json().data;
    assert.equal(
      summaries.find((p: { id: string }) => p.id === 'test').status,
      'ready',
    );
    const broken = summaries.find((p: { id: string }) => p.id === 'broken');
    assert.equal(broken.status, 'unreadable');
    assert.equal(broken.error.code, 'CORRUPT_PROJECT');
    assert.equal((await store.read('test')).title, 'Test world');
  }
});

test('vision batches preserve old models, publish atomically, replay, survive restart and restore snapshots', async (t) => {
  const { visionFixture } = await import('./vision-fixture.js');
  const { store, root, batch, scene } = await fixture(t);
  assert.equal((await store.read('test')).vision, undefined);
  const update = batch([{ type: 'project.vision.set', vision: visionFixture }]);
  await store.apply(update, true);
  assert.equal((await store.read('test')).vision, undefined);
  const result = await store.apply(update);
  assert.deepEqual(await store.apply(update), result);
  let current = await new Store(root).read('test');
  assert.deepEqual(current.vision, visionFixture);
  assert.equal(current.title, visionFixture.name);
  assert.equal(current.layoutRevision, 0);
  await assert.rejects(
    store.apply(
      batch(
        [{ type: 'project.vision.set', vision: visionFixture }],
        0,
        'stale',
      ),
    ),
    hasCode('CONTENT_CONFLICT'),
  );
  await assert.rejects(
    store.apply(
      batch(
        [
          {
            type: 'project.vision.set',
            vision: { ...visionFixture, name: 'Should not persist' },
          },
          {
            type: 'scene.create',
            scene: { ...scene('bad'), mainAssetId: 'missing' },
          },
        ],
        1,
        'invalid',
      ),
    ),
  );
  await assert.rejects(
    store.apply(
      batch(
        [
          {
            type: 'project.vision.set',
            vision: {
              ...visionFixture,
              references: [{ url: 'javascript:alert(1)', relevance: '' }],
            },
          },
        ],
        1,
        'unsafe',
      ),
    ),
  );
  current = await store.read('test');
  assert.equal(current.title, visionFixture.name);
  assert.equal(current.contentRevision, 1);
  await store.apply(
    batch(
      [
        {
          type: 'project.vision.set',
          vision: { ...visionFixture, summary: 'Updated summary' },
        },
        { type: 'scene.create', scene: scene('first') },
      ],
      1,
      'combined',
    ),
  );
  const backup = (await store.backups('test'))[0];
  await store.restore('test', {
    backupId: backup,
    expectedContentRevision: 2,
    expectedLayoutRevision: 0,
  });
  current = await store.read('test');
  assert.equal(current.vision?.summary, visionFixture.summary);
  assert.equal(current.scenes.length, 0);
  const oldBackup = (await store.backups('test')).find(
    (name) => name !== backup && name.includes('_0_'),
  );
  // The original pre-vision snapshot must still decode through the normal restore path.
  const backups = await store.backups('test');
  const original = oldBackup ?? backups[backups.length - 1];
  await store.restore('test', {
    backupId: original,
    expectedContentRevision: current.contentRevision,
    expectedLayoutRevision: current.layoutRevision,
  });
  assert.equal((await store.read('test')).vision, undefined);
});

test('named storyboards copy a legacy project and keep revisions, assets, recovery and changes isolated', async (t) => {
  const { root, store, scene, batch, asset } = await fixture(t);
  const baseBatch = batch([{ type: 'scene.create', scene: scene('lobby') }]);
  const baseResult = await store.apply(baseBatch);
  await store.layout('test', {
    expectedLayoutRevision: 0,
    positions: { lobby: { x: 120, y: 60 } },
  });
  const baseline = await store.read('test');
  const history = await store.backups('test');
  assert.equal(baseline.storyboard, undefined);
  await assert.rejects(
    store.createStoryboard('test', { name: 'baseline' }),
    hasCode('ALREADY_EXISTS'),
  );
  const fork = await store.createStoryboard('test', {
    name: 'Research Office',
  });
  assert.deepEqual(fork.storyboard, {
    projectId: 'test',
    name: 'Research Office',
    sourceId: 'test',
    sourceContentRevision: baseResult.contentRevision,
  });
  assert.deepEqual(fork.positions, baseline.positions);
  assert.deepEqual(fork.scenes, baseline.scenes);
  assert.equal(fork.layoutRevision, 0);
  assert.deepEqual(await store.backups(fork.id), []);
  assert.deepEqual(
    await readFile(await store.assetFile(fork.id, asset.id, false)),
    await readFile(await store.assetFile('test', asset.id, false)),
  );
  await store.apply({
    ...baseBatch,
    projectId: fork.id,
    operations: [
      { type: 'scene.patch', id: 'lobby', changes: { title: 'New lobby' } },
    ],
  });
  await store.layout(fork.id, {
    expectedLayoutRevision: 0,
    positions: { lobby: { x: 0, y: 0 } },
  });
  await store.viewport(fork.id, { x: 25, y: 10, zoom: 1 });
  const restarted = new Store(root);
  assert.deepEqual(await restarted.read('test'), baseline);
  assert.deepEqual(await restarted.backups('test'), history);
  assert.deepEqual(await restarted.apply(baseBatch), baseResult);
  assert.equal(await restarted.viewport('test'), null);
  assert.deepEqual(await restarted.viewport(fork.id), {
    x: 25,
    y: 10,
    zoom: 1,
  });
  assert.equal((await restarted.read(fork.id)).scenes[0].title, 'New lobby');
  assert.deepEqual((await restarted.read(fork.id)).positions.lobby, {
    x: 0,
    y: 0,
  });
  const second = await restarted.createStoryboard(fork.id, {
    name: 'Second proposal',
  });
  assert.equal(second.storyboard?.projectId, 'test');
  assert.equal(second.storyboard?.sourceId, fork.id);
  assert.equal(second.scenes[0].title, 'New lobby');
  const backup = (await restarted.backups(fork.id))[0];
  await writeFile(join(root, 'projects', fork.id, 'project.json'), 'damaged');
  const [project] = await restarted.list();
  assert.equal(project.status, 'ready');
  assert.deepEqual(project.storyboards, [
    { id: fork.id, name: 'Research Office', status: 'unreadable' },
    { id: second.id, name: 'Second proposal', status: 'ready' },
  ]);
  await assert.rejects(
    restarted.createStoryboard('test', { name: 'research office' }),
    hasCode('ALREADY_EXISTS'),
  );
  await restarted.restore(fork.id, { backupId: backup, recoverCorrupt: true });
  assert.deepEqual((await restarted.read(fork.id)).storyboard, fork.storyboard);
  assert.deepEqual(await restarted.read('test'), baseline);
  await writeFile(join(root, 'projects', 'test', 'project.json'), 'damaged');
  const [damagedBaseline] = await restarted.list();
  assert.equal(damagedBaseline.status, 'unreadable');
  assert.deepEqual(damagedBaseline.storyboards, [
    { id: fork.id, name: 'Research Office', status: 'ready' },
    { id: second.id, name: 'Second proposal', status: 'ready' },
  ]);
  assert.equal((await restarted.read(second.id)).scenes[0].title, 'New lobby');
});

test('a copy with damaged asset paths leaves the source and published library untouched', async (t) => {
  const { root, store, asset } = await fixture(t);
  const path = join(root, 'projects', 'test', 'project.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  data.assets[asset.id].path = '../test/project.json';
  const damaged = JSON.stringify(data);
  await writeFile(path, damaged);
  const before = await store.list();
  await assert.rejects(
    store.createStoryboard('test', { name: 'Research Office' }),
    hasCode('INVALID_ASSET'),
  );
  assert.equal(await readFile(path, 'utf8'), damaged);
  assert.deepEqual(await store.list(), before);
  assert.deepEqual(await readdir(join(root, 'projects')), ['test']);
});
