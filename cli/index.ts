import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataRoot } from '../shared/config.js';
import { schemas, Id } from '../shared/schema.js';

const args = process.argv.slice(2);
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const help = `Scene Loom — agent interface\nAll results are JSON. Inputs are JSON files or - for stdin.\n\n  schema [batch|project|layout|createProject|importAsset|restore|viewport]\n  project list\n  project create INPUT\n  project read PROJECT_ID\n  project apply PROJECT_ID INPUT [--dry-run]\n  asset import PROJECT_ID INPUT\n  scene read PROJECT_ID SCENE_ID\n  layout patch PROJECT_ID INPUT\n  backup list PROJECT_ID\n  backup restore PROJECT_ID INPUT\n\nStart the service with npm run dev (or npm run build && npm start).\nSet SCENE_LOOM_DATA_DIR for an alternate absolute local data root.\nAsset import INPUT: {"path":"/absolute/path/image.png"}\nRead docs/agent-interface.md before mutations.`;
async function input(path?: string) {
  if (!path) throw new Error('Provide a JSON file path or - for stdin.');
  if (path === '-') {
    let raw = '';
    for await (const c of process.stdin) raw += c;
    return JSON.parse(raw);
  }
  return JSON.parse(await readFile(path, 'utf8'));
}
async function main() {
  if (!args.length || args.includes('--help') || args[0] === 'help') {
    print({ success: true, help });
    return;
  }
  if (args[0] === 'schema') {
    const key = args[1] ?? 'batch';
    if (!Object.hasOwn(schemas, key)) throw new Error('Unknown schema name.');
    print({ success: true, data: schemas[key as keyof typeof schemas]() });
    return;
  }
  const [group, verb, id, path] = args;
  const command = `${group} ${verb}`;
  const allowed = [
    'project list',
    'project create',
    'project read',
    'project apply',
    'asset import',
    'scene read',
    'layout patch',
    'backup list',
    'backup restore',
  ];
  if (!allowed.includes(command))
    throw new Error('Unknown command. Run --help.');
  if (command !== 'project list' && command !== 'project create') Id.parse(id);
  let route = '/api/projects',
    method = 'GET',
    body: unknown;
  switch (command) {
    case 'project create':
      method = 'POST';
      body = await input(id);
      break;
    case 'project read':
      route += `/${id}`;
      break;
    case 'project apply':
      route += `/${id}/apply${args.includes('--dry-run') ? '?dryRun=true' : ''}`;
      method = 'POST';
      body = await input(path);
      break;
    case 'asset import':
      route += `/${id}/assets`;
      method = 'POST';
      body = await input(path);
      break;
    case 'scene read':
      Id.parse(path);
      route += `/${id}/scenes/${path}`;
      break;
    case 'layout patch':
      route += `/${id}/layout`;
      method = 'PATCH';
      body = await input(path);
      break;
    case 'backup list':
      route += `/${id}/backups`;
      break;
    case 'backup restore':
      route += `/${id}/restore`;
      method = 'POST';
      body = await input(path);
      break;
  }
  const runtime = JSON.parse(
    await readFile(join(dataRoot(), 'runtime.json'), 'utf8').catch(() => {
      throw new Error(
        'Scene Loom is not running for this data directory. Start npm run dev or npm start; match SCENE_LOOM_DATA_DIR.',
      );
    }),
  );
  let response: Response;
  try {
    response = await fetch(`${runtime.url}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${runtime.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('Cannot reach the local service. Restart it and retry.');
  }
  print(await response.json());
  if (!response.ok) process.exitCode = 1;
}
main().catch((e) => {
  print({
    success: false,
    error: {
      code: 'CLI_ERROR',
      message: e.message,
      suggestion: 'Run --help, verify JSON input, and check the local service.',
    },
  });
  process.exitCode = 1;
});
