/** Opt-in example seed. Supply your own four local images; never runs at app startup. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const images = process.argv.slice(2);
if (images.length !== 4)
  throw new Error(
    'Usage: npm run demo -- /absolute/arrival.jpg /absolute/forest.jpg /absolute/shore.jpg /absolute/beacon.jpg. Creates a clearly labeled example project in the running service.',
  );
const temp = await mkdtemp(join(tmpdir(), 'scene-loom-demo-'));
async function run(args: string[], input?: unknown) {
  const file = join(temp, 'input.json');
  if (input !== undefined) await writeFile(file, JSON.stringify(input));
  const raw = execFileSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'cli/index.ts',
      ...args,
      ...(input === undefined ? [] : [file]),
    ],
    { encoding: 'utf8' },
  );
  const result = JSON.parse(raw);
  if (!result.success) throw new Error(raw);
  return result.data;
}
try {
  const project = await run(['project', 'create'], {
    title: 'Tideglass — example',
  });
  const assets: { id: string }[] = [];
  for (const path of images) {
    await readFile(resolve(path));
    assets.push(
      await run(['asset', 'import', project.id], {
        path: resolve(path),
        kind: 'project-image',
      }),
    );
  }
  const titles = [
    'A shore without a name',
    'Follow the treeline',
    'Where the tide retreats',
    'The last light',
  ];
  const descriptions = [
    'You wake on a shore at low tide. An intermittent light blinks from the distant headland. Two paths lead inland.',
    'A narrow trail winds through the trees. Wind carries a low mechanical hum from somewhere ahead.',
    'The exposed shore reveals a crossing. The water will return, but the beacon is closer from here.',
    'Both paths meet beneath the beacon. Its light is still turning, though no one appears to be tending it.',
  ];
  const operations: unknown[] = titles.map((title, i) => ({
    type: 'scene.create',
    scene: {
      id: `scene_${i + 1}`,
      title,
      description: descriptions[i],
      notes: [
        'Establish the place before offering the choice. Let the distant light guide attention.',
        'A quieter, exploratory route. Keep glimpses of the beacon between the trees.',
        'A more exposed route. Use sound and the changing shoreline to suggest time passing.',
        'Converge the routes without erasing their different moods. Leave the next reveal open.',
      ][i],
      mainAssetId: assets[i].id,
      supportingAssetIds: i === 0 ? [assets[2].id] : [],
    },
    ...(i > 0
      ? { placement: { nearSceneId: i === 3 ? 'scene_2' : 'scene_1' } }
      : {}),
  }));
  for (const [id, source, target, label] of [
    ['edge_1', 'scene_1', 'scene_2', 'Into the trees'],
    ['edge_2', 'scene_1', 'scene_3', 'Along the shore'],
    ['edge_3', 'scene_2', 'scene_4', 'Follow the signal'],
    ['edge_4', 'scene_3', 'scene_4', 'Reach the headland'],
  ])
    operations.push({
      type: 'connection.create',
      connection: { id, sourceSceneId: source, targetSceneId: target, label },
    });
  await run(['project', 'apply', project.id], {
    schemaVersion: 1,
    projectId: project.id,
    requestId: 'demo_seed',
    expectedContentRevision: 0,
    operations,
  });
  await run(['layout', 'patch', project.id], {
    expectedLayoutRevision: 0,
    positions: {
      scene_1: { x: 0, y: 220 },
      scene_2: { x: 430, y: 0 },
      scene_3: { x: 430, y: 440 },
      scene_4: { x: 860, y: 220 },
    },
  });
  console.log(
    JSON.stringify(
      { success: true, projectId: project.id, title: project.title },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
