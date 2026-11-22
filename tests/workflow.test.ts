import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { StudioError } from '../server/store.js';
import { Batch } from '../shared/schema.js';

const libraryId =
  'scene-loom-' + createHash('sha256').update('test').digest('hex');
const gap = 'No matching asset in the linked library.';
const source = { libraryId, assetId: 'desk', revisionId: 'model1' };
const hasCode = (code: string) => (e: unknown) =>
  e instanceof StudioError && e.code === code;

async function setup(t: {
  after: (fn: () => Promise<void>) => void;
  mock: { method: (...args: never[]) => unknown };
}) {
  const root = await mkdtemp(join(tmpdir(), 'scene-loom-workflow-'));
  const foundry = join(root, 'foundry');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(foundry);
  await writeFile(
    join(foundry, 'runtime.json'),
    JSON.stringify({ url: 'http://127.0.0.1:4329', token: 'fixture' }),
  );
  const previous = process.env.MESH_FOUNDRY_DATA_DIR;
  process.env.MESH_FOUNDRY_DATA_DIR = foundry;
  const library = {
    id: libraryId,
    assets: [] as { id: string; name: string }[],
    accepted: {} as Record<string, string>,
    acceptance: [] as { revisionId: string }[],
    revisions: [] as object[],
  };
  const state = { down: false };
  (t.mock.method as (...args: unknown[]) => unknown)(
    globalThis,
    'fetch',
    async () => {
      if (state.down) throw new Error('offline');
      return Response.json(library);
    },
  );
  const { app, store, token } = await createApp({ root, serve: false });
  t.after(async () => {
    await app.close();
    if (previous === undefined) delete process.env.MESH_FOUNDRY_DATA_DIR;
    else process.env.MESH_FOUNDRY_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  await store.create({ id: 'test', title: 'Test world' });
  await store.settings('test', { meshFoundryEnabled: true });
  await store.apply({
    schemaVersion: 1,
    projectId: 'test',
    expectedContentRevision: 0,
    requestId: 'scene',
    operations: [
      {
        type: 'scene.create',
        scene: {
          id: 'room',
          title: 'Room',
          description: 'A room.',
          notes: '',
          supportingAssetIds: [],
          selectedAssets: [{ name: 'Desk', required: true }],
        },
      },
    ],
  });
  const host = { host: '127.0.0.1:4318' };
  const agent = { ...host, authorization: `Bearer ${token}` };
  // The browser session flow is the only way to receive the owner cookie.
  const session = await app.inject({ url: '/api/session', headers: host });
  const cookies = ([session.headers['set-cookie']].flat() as string[]).map(
    (c) => c.split(';')[0],
  );
  const owner = {
    ...host,
    origin: 'http://127.0.0.1:4318',
    cookie: cookies.join('; '),
  };
  const get = async (path: string, headers: Record<string, string>) =>
    await app.inject({ url: `/api/projects/test/${path}`, headers });
  const post = async (
    path: string,
    payload: object,
    headers: Record<string, string>,
  ) =>
    await app.inject({
      method: 'POST',
      url: `/api/projects/test/${path}`,
      headers,
      payload,
    });
  const workflow = async () =>
    (await get('scenes/room/workflow', agent)).json().data;
  const accept = () => {
    library.assets = [{ id: 'desk', name: 'Desk' }];
    library.accepted = { desk: 'model1' };
    library.acceptance = [{ revisionId: 'model1' }];
    library.revisions = [
      {
        id: 'model1',
        assetId: 'desk',
        stage: 'model',
        fixture: false,
        files: [{ kind: 'model' }],
      },
    ];
  };
  const sync = async (entries: object[], requestId: string) => {
    const project = await store.read('test');
    const events = project.scenes[0].rehearsalEvents ?? [];
    return store.apply({
      schemaVersion: 1,
      projectId: 'test',
      expectedContentRevision: project.contentRevision,
      requestId,
      operations: [
        {
          type: 'rehearsal.record',
          id: 'room',
          afterEventId: events.at(-1)?.eventId ?? null,
          event: {
            kind: 'orchestration',
            eventId: requestId,
            record: {
              stage: 'sync',
              inputRevision: project.rehearsalInputRevision!,
              libraryId,
              entries,
            },
          } as never,
        },
      ],
    });
  };
  return {
    root,
    store,
    app,
    library,
    state,
    agent,
    owner,
    get,
    post,
    workflow,
    accept,
    sync,
  };
}

test('live Foundry acceptance outranks a stale snapshot and degrades visibly when Foundry is unreachable', async (t) => {
  const s = await setup(t as never);
  await s.sync([{ name: 'Desk', required: true, issue: gap }], 'sync1');
  let status = await s.workflow();
  assert.equal(status.live, true);
  assert.equal(status.next, 'resolve');
  // The owner accepts the asset in Foundry; Loom's snapshot still shows a gap.
  s.accept();
  status = await s.workflow();
  assert.equal(status.live, true);
  assert.equal(status.drifted, true);
  assert.deepEqual(status.entries[0].source, source);
  assert.equal(status.recorded[0].source, undefined);
  assert.equal(status.next, 'sync');
  // Persisting the live read as a fresh sync succeeds; no stored flag blocks it.
  await s.sync([{ name: 'Desk', required: true, source }], 'sync2');
  status = await s.workflow();
  assert.equal(status.drifted, false);
  assert.equal(status.next, 'plan');
  // Foundry going away shows the last recorded state, marked not live.
  s.state.down = true;
  status = await s.workflow();
  assert.equal(status.live, false);
  assert.match(status.reason, /could not be read/);
  assert.equal(status.next, 'plan');
  assert.deepEqual(status.entries[0].source, source);
});

test('a stale card action returns the current action instead of a dead end', async (t) => {
  const s = await setup(t as never);
  await s.sync([{ name: 'Desk', required: true, issue: gap }], 'sync1');
  const check = async (action: string) =>
    (await s.post('scenes/room/card-action', { action }, s.owner)).json().data;
  // Unresolved required assets still offer the sync action.
  assert.equal((await check('sync')).status, 'current');
  assert.equal((await check('plan')).status, 'changed');
  s.accept();
  // Foundry moved on: the card learns the real action from the same call.
  const moved = await check('plan');
  assert.equal(moved.status, 'changed');
  assert.equal(moved.action, 'sync');
  assert.equal(moved.live, true);
  // Nothing was applied by the check.
  const project = await s.store.read('test');
  assert.equal(project.scenes[0].rehearsalEvents?.length, 1);
  await s.sync([{ name: 'Desk', required: true, source }], 'sync2');
  assert.equal((await check('plan')).status, 'current');
  assert.equal((await check('sync')).status, 'changed');
});

test('only the owner can resolve a required selection, and the prior state is kept', async (t) => {
  const s = await setup(t as never);
  await s.sync([{ name: 'Desk', required: true, issue: gap }], 'sync1');
  const agentTry = await s.post(
    'scenes/room/owner-resolution',
    { name: 'Desk' },
    s.agent,
  );
  assert.equal(agentTry.statusCode, 403);
  assert.equal(agentTry.json().error.code, 'OWNER_ONLY');
  const viaApply = await s.post(
    'apply',
    {
      schemaVersion: 1,
      projectId: 'test',
      expectedContentRevision: (await s.store.read('test')).contentRevision,
      requestId: 'agent-resolution',
      operations: [
        {
          type: 'rehearsal.record',
          id: 'room',
          afterEventId: 'sync1',
          event: {
            kind: 'orchestration',
            eventId: 'agent-resolution',
            record: {
              stage: 'owner-resolution',
              syncId: 'sync1',
              name: 'Desk',
              prior: { name: 'Desk', required: true, issue: gap },
            },
          },
        },
      ],
    },
    s.agent,
  );
  assert.equal(viaApply.statusCode, 403);
  assert.equal(
    (await s.store.read('test')).scenes[0].rehearsalEvents?.length,
    1,
  );
  const done = await s.post(
    'scenes/room/owner-resolution',
    { name: 'desk', reason: 'Using the prototype.' },
    s.owner,
  );
  assert.equal(done.statusCode, 200);
  const events = (await s.store.read('test')).scenes[0].rehearsalEvents!;
  const record = (events.at(-1) as { record: Record<string, unknown> }).record;
  assert.equal(record.stage, 'owner-resolution');
  assert.deepEqual(record.prior, { name: 'Desk', required: true, issue: gap });
  // The original sync stays as it was recorded.
  assert.deepEqual(
    (events[0] as { record: { entries: object[] } }).record.entries,
    [{ name: 'Desk', required: true, issue: gap }],
  );
  const status = await s.workflow();
  assert.equal(status.next, 'plan');
  assert.equal(status.entries[0].ownerResolved !== undefined, true);
  // A newer resolution supersedes the older one for the same selection.
  const again = await s.post(
    'scenes/room/owner-resolution',
    { name: 'Desk', reason: 'Changed my mind.' },
    s.owner,
  );
  assert.equal(again.statusCode, 200);
  // Foundry acceptance, once it exists, takes precedence over the override.
  s.accept();
  const live = await s.workflow();
  assert.deepEqual(live.entries[0].source, source);
  assert.equal(live.entries[0].ownerResolved, undefined);
});

test('projects saved with the retired fit loop still load; new fit records are refused', async (t) => {
  const s = await setup(t as never);
  const file = join(s.root, 'projects/test/project.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const model = { libraryId: 'lib', assetId: 'desk', revisionId: 'm1' };
  const draft = { dataDir: '/data', port: 4331, revisionId: 'r1', link: 'x' };
  saved.scenes[0].rehearsalEvents = [
    {
      kind: 'review',
      eventId: 'r',
      inputRevision: 0,
      blockout: 'ready',
      imports: 'ready',
      scope: 'Room',
      findings: ['ok'],
    },
    {
      kind: 'candidate-review',
      eventId: 'cr',
      requirementId: 'req',
      model,
      verdict: 'accepted',
      ownerOverride: { rejectionEventId: 'x', reason: 'Owner call.' },
      evidence: ['ok'],
    },
    {
      kind: 'fit',
      eventId: 'f',
      requirementId: 'req',
      model,
      rehearsalRevisionId: 'r1',
      assembled: draft,
      verdict: 'pass',
      evidence: ['ok'],
    },
    {
      kind: 'orchestration',
      eventId: 'd',
      record: {
        stage: 'draft',
        builder: 'B',
        url: 'http://127.0.0.1:4331',
        draftId: 'a'.repeat(64),
        scenarioId: 'arrival',
      },
    },
  ];
  await writeFile(file, JSON.stringify(saved));
  const loaded = await s.store.read('test');
  assert.equal(loaded.scenes[0].rehearsalEvents?.length, 4);
  await assert.rejects(
    s.store.apply({
      schemaVersion: 1,
      projectId: 'test',
      expectedContentRevision: loaded.contentRevision,
      requestId: 'fit-again',
      operations: [
        {
          type: 'rehearsal.record',
          id: 'room',
          afterEventId: 'd',
          event: {
            kind: 'fit',
            eventId: 'f2',
            requirementId: 'req',
            model,
            rehearsalRevisionId: 'r1',
            verdict: 'pass',
            evidence: ['ok'],
          },
        },
      ],
    }),
    hasCode('LEGACY_RECORD'),
  );
});

test('draft records accept optional hex digests and still accept the old shape', () => {
  const record = (extra: object) =>
    Batch.safeParse({
      schemaVersion: 1,
      projectId: 'test',
      expectedContentRevision: 0,
      requestId: 'digests',
      operations: [
        {
          type: 'rehearsal.record',
          id: 'room',
          afterEventId: null,
          event: {
            kind: 'orchestration',
            eventId: 'draft',
            record: {
              stage: 'draft',
              builder: 'B',
              url: 'http://127.0.0.1:4331',
              draftId: 'a'.repeat(64),
              scenarioId: 'arrival',
              ...extra,
            },
          },
        },
      ],
    }).success;
  assert.equal(record({}), true);
  assert.equal(
    record({ contentDigest: 'b'.repeat(64), specDigest: 'c'.repeat(64) }),
    true,
  );
  assert.equal(record({ specDigest: 'not hex' }), false);
});

const gapSync = (s: Awaited<ReturnType<typeof setup>>) =>
  s.sync([{ name: 'Desk', required: true, issue: gap }], 'sync1');
const resolveDesk = (s: Awaited<ReturnType<typeof setup>>, body: object = {}) =>
  s.post('scenes/room/owner-resolution', { name: 'Desk', ...body }, s.owner);

test('owner resolution needs the browser-only owner secret, never the CLI token', async (t) => {
  const s = await setup(t as never);
  await gapSync(s);
  const token = s.agent.authorization.replace('Bearer ', '');
  const origin = 'http://127.0.0.1:4318';
  // CLI token as cookie plus Origin (what an agent reading runtime.json can do).
  const forged = await s.post(
    'scenes/room/owner-resolution',
    { name: 'Desk' },
    { host: '127.0.0.1:4318', origin, cookie: `scene_loom=${token}` },
  );
  assert.equal(forged.statusCode, 403);
  assert.equal(forged.json().error.code, 'OWNER_ONLY');
  // Bearer token together with the owner cookie is still the CLI path.
  const bearer = await s.post(
    'scenes/room/owner-resolution',
    { name: 'Desk' },
    { ...s.owner, authorization: `Bearer ${token}` },
  );
  assert.equal(bearer.statusCode, 403);
  // A session started with Authorization gets no owner cookie, and the
  // secret never appears in a body.
  const cli = await s.app.inject({
    url: '/api/session',
    headers: s.agent,
  });
  const set = [cli.headers['set-cookie']].flat().join(';');
  assert.doesNotMatch(set, /scene_loom_owner/);
  const ownerValue = s.owner.cookie.match(/scene_loom_owner=([a-f0-9]+)/)![1];
  assert.equal(cli.body.includes(ownerValue), false);
  assert.match(s.owner.cookie, /scene_loom_owner=/);
  assert.equal((await resolveDesk(s)).statusCode, 200);
});

test('a resolution is scoped to its sync and a replaced selection is not waived', async (t) => {
  const s = await setup(t as never);
  await gapSync(s);
  assert.equal((await resolveDesk(s)).statusCode, 200);
  assert.equal((await s.workflow()).next, 'plan');
  // The selection changes: Foundry now has two matching assets.
  s.state.down = false;
  s.library.assets = [
    { id: 'a', name: 'Desk' },
    { id: 'b', name: 'Desk' },
  ];
  assert.equal((await s.workflow()).next, 'sync');
  await s.sync(
    [
      {
        name: 'Desk',
        required: true,
        issue: 'Multiple assets match this selection.',
      },
    ],
    'sync2',
  );
  const status = await s.workflow();
  assert.equal(status.next, 'resolve');
  assert.equal(status.entries[0].ownerResolved, undefined);
  // The owner can resolve the new state and change a wrong choice later.
  assert.equal((await resolveDesk(s)).statusCode, 200);
  assert.equal((await resolveDesk(s, { reason: 'Better.' })).statusCode, 200);
  assert.equal((await s.workflow()).next, 'plan');
});

test('a pinned owner source must be accepted live; unreachable Foundry allows only a waiver', async (t) => {
  const s = await setup(t as never);
  await gapSync(s);
  const bad = await resolveDesk(s, { source });
  assert.equal(bad.statusCode, 409);
  assert.match(bad.json().error.message, /not currently accepted/);
  s.accept();
  s.state.down = true;
  const offline = await resolveDesk(s, { source });
  assert.equal(offline.statusCode, 503);
  const waiver = await resolveDesk(s, { reason: 'Offline waiver.' });
  assert.equal(waiver.statusCode, 200);
  s.state.down = false;
  const pinned = await resolveDesk(s, { source });
  assert.equal(pinned.statusCode, 200);
  const events = (await s.store.read('test')).scenes[0].rehearsalEvents!;
  assert.deepEqual(
    (events.at(-1) as { record: { source: object } }).record.source,
    source,
  );
});

test('card actions report an unverified state when Foundry cannot be read', async (t) => {
  const s = await setup(t as never);
  await gapSync(s);
  s.state.down = true;
  const check = (
    await s.post('scenes/room/card-action', { action: 'sync' }, s.owner)
  ).json().data;
  assert.equal(check.status, 'unverified');
  assert.equal(check.live, false);
  assert.match(check.reason, /could not be read/);
});

test('after an owner resolution, drift detection compares overlaid and raw entries consistently', async (t) => {
  const s = await setup(t as never);
  await gapSync(s);
  assert.equal((await resolveDesk(s)).statusCode, 200);
  const status = await s.workflow();
  assert.equal(status.drifted, false);
  assert.equal(status.next, 'plan');
  assert.equal(status.entries[0].ownerResolved !== undefined, true);
  assert.equal(status.recorded[0].ownerResolved !== undefined, true);
  // A sync of the unchanged raw manifest is refused as already current.
  await assert.rejects(
    s.sync([{ name: 'Desk', required: true, issue: gap }], 'sync2'),
    hasCode('STALE_REHEARSAL'),
  );
});

const digest = 'd'.repeat(64);
async function seedDraft(s: Awaited<ReturnType<typeof setup>>) {
  s.accept();
  await s.sync([{ name: 'Desk', required: true, source }], 'sync1');
  const file = join(s.root, 'projects/test/project.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.scenes[0].rehearsalEvents.push(
    {
      kind: 'orchestration',
      eventId: 'plan1',
      record: {
        stage: 'plan',
        syncId: 'sync1',
        planner: 'P',
        plan: {
          intent: 'Room',
          pieces: [
            {
              id: 'desk',
              label: 'Desk',
              source,
              position: [0, 0, 0],
              size: [1, 1, 1],
              scale: [1, 1, 1],
              rotation: [0, 0, 0],
              behavior: 'Static.',
            },
          ],
          cameraOrTraversal: ['Walk in.'],
          checks: ['Desk visible.'],
          references: [],
        },
      },
    },
    {
      kind: 'orchestration',
      eventId: 'draft1',
      record: {
        stage: 'draft',
        builder: 'B',
        url: 'http://127.0.0.1:4331',
        draftId: digest,
        scenarioId: 'arrival',
      },
    },
  );
  await writeFile(file, JSON.stringify(saved));
}
const review = async (
  s: Awaited<ReturnType<typeof setup>>,
  eventId: string,
  record: object,
) => {
  const project = await s.store.read('test');
  return s.store.apply({
    schemaVersion: 1,
    projectId: 'test',
    expectedContentRevision: project.contentRevision,
    requestId: eventId,
    operations: [
      {
        type: 'rehearsal.record',
        id: 'room',
        afterEventId: project.scenes[0].rehearsalEvents!.at(-1)!.eventId,
        event: {
          kind: 'orchestration',
          eventId,
          record: {
            stage: 'game-review',
            draftId: digest,
            reviewer: 'R',
            build: 'build-1',
            route: '/room',
            findings: ['SS1 Desk floats.'],
            ...record,
          },
        },
      },
    ],
  });
};
const fullEvidence = {
  propCaptures: [{ piece: 'desk', captureRef: 'shots/desk.png' }],
  scaleChecks: [{ piece: 'desk', against: 'Hero 1.8 m', result: '0.75 m' }],
  clipChecks: [
    { piece: 'hero', clip: 'walk', action: 'Cross room', result: 'Matches' },
  ],
};

test('a ready game review is rejected without evidence in every category', async (t) => {
  const s = await setup(t as never);
  await seedDraft(s);
  await assert.rejects(
    review(s, 'r-none', { verdict: 'ready' }),
    (e: unknown) =>
      hasCode('REVIEW_EVIDENCE_REQUIRED')(e) &&
      /propCaptures, scaleChecks, clipChecks/.test((e as Error).message),
  );
  await assert.rejects(
    review(s, 'r-partial', {
      verdict: 'ready',
      evidence: { ...fullEvidence, clipChecks: [] },
    }),
    (e: unknown) =>
      hasCode('REVIEW_EVIDENCE_REQUIRED')(e) &&
      /Missing: clipChecks\./.test((e as Error).message),
  );
  assert.equal(
    (await s.store.read('test')).scenes[0].rehearsalEvents?.length,
    3,
  );
  // Findings-only reviews need no evidence.
  await review(s, 'r-changes', { verdict: 'changes-requested' });
  await review(s, 'r-ready', { verdict: 'ready', evidence: fullEvidence });
  const events = (await s.store.read('test')).scenes[0].rehearsalEvents!;
  assert.equal(events.length, 5);
  // A review of another draft is stale.
  await assert.rejects(
    review(s, 'r-stale', {
      verdict: 'changes-requested',
      draftId: 'e'.repeat(64),
    }),
    hasCode('STALE_REHEARSAL'),
  );
});

test('game review records save and old reviewless projects still load', async (t) => {
  const s = await setup(t as never);
  await seedDraft(s);
  await review(s, 'r-ready', { verdict: 'ready', evidence: fullEvidence });
  const file = join(s.root, 'projects/test/project.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const { orchestrationState, evidenceCounts } =
    await import('../shared/orchestration.js');
  const state = orchestrationState(saved.scenes[0].rehearsalEvents, 0);
  assert.deepEqual(evidenceCounts(state.gameReview?.evidence), {
    propCaptures: 1,
    scaleChecks: 1,
    clipChecks: 1,
  });
  // A ready record stored without evidence (an older shape) still loads.
  delete saved.scenes[0].rehearsalEvents.at(-1).record.evidence;
  await writeFile(file, JSON.stringify(saved));
  const loaded = await s.store.read('test');
  assert.equal(loaded.scenes[0].rehearsalEvents?.length, 4);
  assert.deepEqual(
    evidenceCounts(
      orchestrationState(loaded.scenes[0].rehearsalEvents, 0).gameReview
        ?.evidence,
    ),
    { propCaptures: 0, scaleChecks: 0, clipChecks: 0 },
  );
  assert.equal(
    Batch.safeParse({
      schemaVersion: 1,
      projectId: 'test',
      expectedContentRevision: 0,
      requestId: 'x',
      operations: [
        {
          type: 'rehearsal.record',
          id: 'room',
          afterEventId: null,
          event: {
            kind: 'orchestration',
            eventId: 'e',
            record: {
              stage: 'game-review',
              draftId: digest,
              reviewer: 'R',
              build: 'b',
              route: '/',
              verdict: 'ready',
              findings: ['ok'],
              evidence: { propCaptures: [{ piece: 'a' }] },
            },
          },
        },
      ],
    }).success,
    false,
  );
});
