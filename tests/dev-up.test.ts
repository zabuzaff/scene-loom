import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatTable, isStale, services, type Row } from '../scripts/dev-up';

const row = (extra: Partial<Row>): Row => ({
  name: 'Svc',
  running: true,
  url: 'http://127.0.0.1:1',
  pid: 7,
  dataDir: '/d',
  revision: 'abc',
  checkoutRevision: 'abc',
  ...extra,
});

test('staleness needs a reported revision that differs from the checkout', () => {
  assert.equal(isStale(row({})), false);
  assert.equal(isStale(row({ revision: 'old' })), true);
  assert.equal(isStale(row({ revision: undefined })), false);
  assert.equal(isStale(row({ revision: 'old', running: false })), false);
});

test('the table lists every service and calls out stale and unreported ones', () => {
  const table = formatTable([
    row({ name: 'Scene Loom' }),
    row({ name: 'Mesh Foundry', revision: undefined }),
    row({ name: 'Scene Rehearsal', revision: 'old', pid: 99 }),
    row({ name: 'Idle', running: false, pid: undefined, url: undefined }),
  ]);
  const lines = table.split('\n');
  assert.match(lines[0], /SERVICE\s+STATE\s+URL\s+PID\s+DATA DIR\s+REVISION/);
  assert.match(lines[1], /Scene Loom\s+running\s/);
  assert.match(lines[2], /Mesh Foundry\s+running\s.*not reported/);
  assert.match(lines[3], /Scene Rehearsal\s+running \(stale\)/);
  assert.match(lines[4], /Idle\s+stopped\s+-\s+-/);
  assert.match(
    table,
    /Scene Rehearsal: stale\. Running old, checkout is abc\. Stop pid 99/,
  );
  assert.doesNotMatch(table, /Scene Loom: stale/);
});

test('status reads runtime.json of a disposable data dir and ignores dead pids', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scene-loom-up-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    SCENE_LOOM_DATA_DIR: join(root, 'loom'),
    MESH_FOUNDRY_DATA_DIR: join(root, 'foundry'),
  };
  const [loom, foundry] = services(env);
  assert.equal(loom.read(loom.checkout, env).running, false);
  await mkdir(join(root, 'loom'));
  await writeFile(
    join(root, 'loom/runtime.json'),
    JSON.stringify({
      url: 'http://127.0.0.1:4441',
      token: 'x',
      pid: process.pid,
      revision: 'old-revision',
    }),
  );
  const live = loom.read(loom.checkout, env);
  assert.equal(live.running, true);
  assert.equal(live.pid, process.pid);
  assert.equal(live.dataDir, join(root, 'loom'));
  assert.equal(isStale(live), true);
  await mkdir(join(root, 'foundry'));
  await writeFile(
    join(root, 'foundry/runtime.json'),
    JSON.stringify({ url: 'http://127.0.0.1:4442', pid: 2 ** 22 + 12345 }),
  );
  assert.equal(foundry.read(foundry.checkout, env).running, false);
});
