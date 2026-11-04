import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataRoot } from '../shared/config.js';
import { createApp } from './app.js';
import { atomicWrite } from './store.js';

const root = dataRoot(),
  port = Number(process.env.SCENE_LOOM_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('SCENE_LOOM_PORT must be an integer between 1024 and 65535.');
await mkdir(root, { recursive: true, mode: 0o700 });
const lock = join(root, 'service.lock');
try {
  await mkdir(lock);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  const pid = Number(await readFile(join(lock, 'pid'), 'utf8').catch(() => ''));
  if (!pid)
    throw new Error(
      'Scene Loom lock is initializing or incomplete. Check running services before removing service.lock.',
      { cause: e },
    );
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
  }
  if (alive)
    throw new Error('Scene Loom is already running for this data directory.', {
      cause: e,
    });
  await rm(lock, { recursive: true, force: true });
  await mkdir(lock);
}
await writeFile(join(lock, 'pid'), String(process.pid));
let cleanup = async () => {
  await rm(join(root, 'runtime.json'), { force: true });
  await rm(lock, { recursive: true, force: true });
};
try {
  const { app, token } = await createApp({
    root,
    port,
    dev: process.argv.includes('--dev'),
  });
  await app.listen({ host: '127.0.0.1', port });
  await atomicWrite(join(root, 'runtime.json'), {
    url: `http://127.0.0.1:${port}`,
    token,
  });
  const old = cleanup;
  cleanup = async () => {
    await app.close();
    await old();
  };
  console.log(`Scene Loom · http://127.0.0.1:${port}\nData · ${root}`);
} catch (e) {
  await cleanup();
  throw e;
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void cleanup().then(() => process.exit(0));
  });
