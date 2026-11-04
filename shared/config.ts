import { homedir } from 'node:os';
import { resolve, isAbsolute, join } from 'node:path';
export function dataRoot() {
  const override = process.env.SCENE_LOOM_DATA_DIR;
  if (override && !isAbsolute(override))
    throw new Error('SCENE_LOOM_DATA_DIR must be an absolute path.');
  return (
    override ?? join(homedir(), 'Library', 'Application Support', 'Scene Loom')
  );
}
export const repositoryRoot = resolve(import.meta.dirname, '..');
