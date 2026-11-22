// One start command for the local studio trio: Scene Loom, Mesh Foundry and
// Scene Rehearsal. `npm run up` starts whichever is not already running and
// prints a status table; `npm run up -- --status` only prints the table.
// It stops nothing, never writes service data, and uses each service's own
// start command and runtime.json (Scene Rehearsal's own --status command).
import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Row = {
  name: string;
  running: boolean;
  url?: string;
  pid?: number;
  dataDir?: string;
  // Revision the running service reports, or undefined when it reports none.
  revision?: string;
  // Revision of the checkout on disk right now.
  checkoutRevision?: string;
  // Set when a status cannot be read at all.
  note?: string;
};

// A running service is stale when it reports a revision that differs from the
// checkout's current one. A service that reports none is never called stale.
export const isStale = (row: Row) =>
  row.running &&
  !!row.revision &&
  !!row.checkoutRevision &&
  row.revision !== row.checkoutRevision;

export function formatTable(rows: Row[]) {
  const header = ['SERVICE', 'STATE', 'URL', 'PID', 'DATA DIR', 'REVISION'];
  const body = rows.map((row) => [
    row.name,
    row.running ? (isStale(row) ? 'running (stale)' : 'running') : 'stopped',
    row.url ?? '-',
    row.pid ? String(row.pid) : '-',
    row.dataDir ?? '-',
    row.revision
      ? row.revision
      : row.running
        ? 'not reported'
        : (row.checkoutRevision ?? '-'),
  ]);
  const widths = header.map((title, i) =>
    Math.max(title.length, ...body.map((line) => line[i].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  const notes = rows.flatMap((row) => [
    ...(isStale(row)
      ? [
          `${row.name}: stale. Running ${row.revision}, checkout is ${row.checkoutRevision}. Stop pid ${row.pid} and run this again to use the checkout.`,
        ]
      : []),
    ...(row.note ? [`${row.name}: ${row.note}`] : []),
  ]);
  return [line(header), ...body.map(line), ...notes].join('\n');
}

const isAlive = (pid: unknown): pid is number => {
  if (!Number.isInteger(pid) || (pid as number) < 1) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};
const readJson = (file: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const text = (value: unknown) =>
  typeof value === 'string' ? value : undefined;

export function gitRevision(cwd: string) {
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  // Same format the services report: short HEAD, plus +uncommitted.
  return (
    (git('rev-parse', '--short', 'HEAD') || 'unknown') +
    (git('status', '--porcelain') ? '+uncommitted' : '')
  );
}

export type Service = {
  name: string;
  checkout: string;
  // Full environment the service sees, so disposable data directories and
  // ports given to this script reach both the status read and the start.
  read: (checkout: string, env: NodeJS.ProcessEnv) => Row;
};

const support = (name: string) =>
  join(homedir(), 'Library/Application Support', name);
const absolute = (value: string | undefined, fallback: string) => {
  const path = value ?? fallback;
  if (!isAbsolute(path)) throw new Error(`${path} must be an absolute path.`);
  return path;
};
const fromRuntime = (
  name: string,
  checkout: string,
  root: string,
  pid?: number,
): Row => {
  const runtime = readJson(join(root, 'runtime.json'));
  const live = pid ?? (runtime?.pid as number | undefined);
  const running = !!runtime && isAlive(live);
  return {
    name,
    running,
    url: running ? text(runtime?.url) : undefined,
    pid: running ? live : undefined,
    dataDir: running ? (text(runtime?.dataDir) ?? root) : root,
    revision: running ? text(runtime?.revision) : undefined,
    checkoutRevision: gitRevision(checkout),
  };
};

export const services = (env: NodeJS.ProcessEnv): Service[] => {
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sibling = (name: string, override?: string) =>
    override ? resolve(override) : resolve(here, '..', name);
  return [
    {
      name: 'Scene Loom',
      checkout: here,
      read: (checkout, e) => {
        const root = absolute(e.SCENE_LOOM_DATA_DIR, support('Scene Loom'));
        // Older builds publish no pid in runtime.json; the lock holds it.
        let pid: number | undefined;
        try {
          pid = Number(readFileSync(join(root, 'service.lock', 'pid'), 'utf8'));
        } catch {
          pid = undefined;
        }
        return fromRuntime('Scene Loom', checkout, root, pid);
      },
    },
    {
      name: 'Mesh Foundry',
      checkout: sibling('mesh-foundry', env.MESH_FOUNDRY_CHECKOUT),
      // Foundry publishes url and pid but no code revision, so it can never
      // be reported stale.
      read: (checkout, e) =>
        fromRuntime(
          'Mesh Foundry',
          checkout,
          absolute(e.MESH_FOUNDRY_DATA_DIR, support('Mesh Foundry')),
        ),
    },
    {
      name: 'Scene Rehearsal',
      checkout: sibling('scene-rehearsal', env.SCENE_REHEARSAL_CHECKOUT),
      // Rehearsal's own status command reports the running service and the
      // checkout's revision.
      read: (checkout, e) => {
        try {
          const out = execFileSync(
            'npm',
            ['--silent', 'start', '--', '--status'],
            {
              cwd: checkout,
              env: e,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            },
          );
          const status = JSON.parse(out.trim().split('\n').at(-1)!);
          const running = status.running as Record<string, unknown> | null;
          return {
            name: 'Scene Rehearsal',
            running: !!running,
            url: text(running?.url),
            pid: running?.pid as number | undefined,
            dataDir: running ? text(running.dataDir) : text(status.root),
            revision: text(running?.revision),
            checkoutRevision: text(status.checkout?.revision),
          };
        } catch {
          return {
            name: 'Scene Rehearsal',
            running: false,
            checkoutRevision: gitRevision(checkout),
            note: 'its status command could not be read (is the checkout installed?).',
          };
        }
      },
    },
  ];
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function start(service: Service, env: NodeJS.ProcessEnv) {
  if (!existsSync(join(service.checkout, 'package.json')))
    return `${service.name}: no checkout at ${service.checkout}; not started.`;
  if (!existsSync(join(service.checkout, 'dist')))
    return `${service.name}: not built. Run npm run build in ${service.checkout}, then run this again.`;
  const logs = join(tmpdir(), 'scene-loom-up');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const log = join(
    logs,
    `${service.name.replaceAll(' ', '-').toLowerCase()}.log`,
  );
  const fd = openSync(log, 'a', 0o600);
  const child = spawn('npm', ['start'], {
    cwd: service.checkout,
    env,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  let exited = false;
  child.on('exit', () => (exited = true));
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (service.read(service.checkout, env).running) return;
    if (exited) break;
  }
  const tail = (() => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').slice(-4).join('\n');
    } catch {
      return '';
    }
  })();
  return `${service.name}: did not start. Log: ${log}\n${tail}`;
}

export async function main(argv: string[], env = process.env) {
  const statusOnly = argv.includes('--status');
  const all = services(env);
  const messages: string[] = [];
  if (!statusOnly)
    for (const service of all) {
      const row = service.read(service.checkout, env);
      if (row.running) {
        console.log(`${service.name}: already running, left alone.`);
        continue;
      }
      console.log(`${service.name}: starting...`);
      const problem = await start(service, env);
      if (problem) messages.push(problem);
    }
  console.log('\n' + formatTable(all.map((s) => s.read(s.checkout, env))));
  if (messages.length) {
    console.error('\n' + messages.join('\n'));
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = await main(process.argv.slice(2));
