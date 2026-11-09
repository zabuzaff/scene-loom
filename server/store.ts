import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, join, basename, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import {
  Id,
  Project,
  Batch,
  CreateProject,
  LayoutPatch,
  ProjectSettings,
  Restore,
  Viewport,
  type ProjectData,
  type BatchData,
  type ProjectSummary,
} from '../shared/schema.js';

export class StudioError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public suggestion = 'Check the input and retry.',
    public location?: string,
  ) {
    super(message);
  }
}
export function fail(
  code: string,
  message: string,
  status = 400,
  suggestion?: string,
  location?: string,
): never {
  throw new StudioError(code, message, status, suggestion, location);
}
type Receipt = { id: string; hash: string; result: MutationResult };
type State = ProjectData & { receipts: Receipt[] };
export type MutationResult = {
  success: true;
  projectId: string;
  contentRevision: number;
  affectedIds: string[];
  warnings: string[];
  dryRun?: boolean;
};
const StoredState = Project.extend({
  receipts: z
    .array(
      z.strictObject({
        id: Id,
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        result: z.strictObject({
          success: z.literal(true),
          projectId: Id,
          contentRevision: z.number().int().nonnegative(),
          affectedIds: z.array(Id),
          warnings: z.array(z.string()),
        }),
      }),
    )
    .max(100)
    .default([]),
});
const hash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function atomicWrite(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
    });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export class Store extends EventEmitter {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(public root: string) {
    super();
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task);
    this.tail = next.catch(() => {});
    return next;
  }
  private folder(id: string) {
    return join(this.root, 'projects', Id.parse(id));
  }
  private async load(id: string): Promise<State> {
    try {
      return StoredState.parse(
        JSON.parse(
          await readFile(join(this.folder(id), 'project.json'), 'utf8'),
        ),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        fail(
          'NOT_FOUND',
          `Project ${id} does not exist.`,
          404,
          'List projects and use an existing project ID.',
        );
      if (e instanceof z.ZodError || e instanceof SyntaxError)
        fail(
          'CORRUPT_PROJECT',
          `Project ${id} could not be read safely.`,
          500,
          'Restore a valid backup; do not overwrite project.json.',
        );
      throw e;
    }
  }
  async read(id: string): Promise<ProjectData> {
    const { receipts: _receipts, ...project } = await this.load(id);
    return project;
  }
  async list(): Promise<ProjectSummary[]> {
    const dir = join(this.root, 'projects');
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((e) => e.isDirectory() && Id.safeParse(e.name).success)
        .map(async (e): Promise<ProjectSummary> => {
          try {
            const p = await this.read(e.name);
            return {
              id: p.id,
              title: p.title,
              status: 'ready',
              sceneCount: p.scenes.length,
              updatedAt: p.updatedAt,
            };
          } catch (error) {
            const known =
              error instanceof StudioError &&
              ['CORRUPT_PROJECT', 'NOT_FOUND'].includes(error.code);
            if (!known && (error as NodeJS.ErrnoException).code !== 'EACCES')
              throw error;
            const issue =
              error instanceof StudioError
                ? error
                : new StudioError(
                    'PROJECT_UNREADABLE',
                    `Project ${e.name} cannot be read.`,
                    500,
                    'Check project folder permissions before retrying.',
                  );
            return {
              id: e.name,
              title: e.name,
              status: 'unreadable',
              error: {
                code: issue.code,
                message: issue.message,
                suggestion: issue.suggestion,
              },
            };
          }
        }),
    );
  }
  async create(input: unknown) {
    return this.serial(async () => {
      const data = CreateProject.parse(input);
      const id = data.id ?? `project_${randomUUID()}`;
      const dir = this.folder(id);
      try {
        await stat(join(dir, 'project.json'));
        fail('ALREADY_EXISTS', `Project ${id} already exists.`, 409);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const p: State = {
        schemaVersion: 1,
        id,
        title: data.title,
        contentRevision: 0,
        layoutRevision: 0,
        updatedAt: new Date().toISOString(),
        scenes: [],
        connections: [],
        positions: {},
        assets: {},
        receipts: [],
      };
      await atomicWrite(join(dir, 'project.json'), p);
      this.emit('change', { projectId: id, kind: 'projects' });
      return this.read(id);
    });
  }
  async importAsset(id: string, path: string) {
    return this.serial(async () => {
      const p = await this.load(id);
      if (!isAbsolute(path))
        fail('INVALID_ASSET', 'Use an absolute local image path.');
      const s = await stat(path).catch(() =>
        fail(
          'INVALID_ASSET',
          'Image file does not exist.',
          400,
          'Generate or locate the image before importing it.',
        ),
      );
      if (!s.isFile() || s.size > 30 * 1024 * 1024)
        fail('INVALID_ASSET', 'Images must be regular files up to 30 MB.');
      const data = await readFile(path);
      const assetId = `asset_${createHash('sha256').update(data).digest('hex').slice(0, 32)}`;
      if (p.assets[assetId]) {
        const a = p.assets[assetId];
        const complete = await Promise.all(
          [a.path, a.thumbnailPath, `assets/${assetId}.source`].map((file) =>
            stat(join(this.folder(id), file)).then(
              () => true,
              () => false,
            ),
          ),
        );
        if (complete.every(Boolean)) return a;
      }
      const dir = this.folder(id);
      await mkdir(join(dir, 'assets'), { recursive: true });
      await mkdir(join(dir, 'thumbnails'), { recursive: true });
      const original = `assets/${assetId}.webp`,
        thumbnail = `thumbnails/${assetId}.webp`;
      let meta: Metadata;
      try {
        const image = sharp(data, {
          limitInputPixels: 40000000,
          failOn: 'warning',
        });
        meta = await image.metadata();
        if (
          !['jpeg', 'png', 'webp', 'avif'].includes(meta.format ?? '') ||
          (meta.pages ?? 1) > 1
        )
          fail('INVALID_ASSET', 'Use a static PNG, JPEG, WebP, or AVIF image.');
        // Force full decoding before publishing; metadata alone accepts corrupt pixel streams.
        await image.rotate().webp({ quality: 93 }).toFile(join(dir, original));
        await sharp(join(dir, original))
          .resize({
            width: 720,
            height: 480,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 82 })
          .toFile(join(dir, thumbnail));
        meta = await sharp(join(dir, original)).metadata();
      } catch (e) {
        await Promise.all([
          unlink(join(dir, original)).catch(() => {}),
          unlink(join(dir, thumbnail)).catch(() => {}),
        ]);
        if (e instanceof StudioError) throw e;
        fail(
          'INVALID_ASSET',
          'Image could not be decoded.',
          400,
          'Supply a valid static PNG, JPEG, WebP, or AVIF image.',
        );
      }
      // Keep exact supplied bytes too; WebP is the normalized display original.
      await writeFile(join(dir, `assets/${assetId}.source`), data, {
        mode: 0o600,
      });
      const asset = {
        id: assetId,
        path: original,
        thumbnailPath: thumbnail,
        mediaType: 'image/webp',
        width: meta!.width!,
        height: meta!.height!,
        originalFilename: basename(path),
      };
      p.assets[assetId] = asset;
      await atomicWrite(join(dir, 'project.json'), p);
      return asset;
    });
  }
  private async validate(p: State) {
    StoredState.parse(p);
    const scenes = new Set(p.scenes.map((s) => s.id));
    if (
      scenes.size !== p.scenes.length ||
      new Set(p.connections.map((c) => c.id)).size !== p.connections.length
    )
      fail(
        'DUPLICATE_ID',
        'Scene and connection IDs must be unique within their collection.',
      );
    for (const scene of p.scenes) {
      const imageIds = scene.mainAssetId
        ? [scene.mainAssetId, ...scene.supportingAssetIds]
        : scene.supportingAssetIds;
      for (const id of imageIds) {
        const asset = p.assets[id];
        if (!asset)
          fail(
            'MISSING_ASSET',
            `Scene ${scene.id} references unimported image ${id}.`,
            400,
            'Import the image, then use the returned asset ID.',
            scene.id,
          );
        await stat(join(this.folder(p.id), asset.path)).catch(() =>
          fail(
            'MISSING_ASSET',
            `Stored image ${id} is missing.`,
            400,
            'Restore the missing project asset.',
            scene.id,
          ),
        );
      }
    }
    for (const c of p.connections)
      if (!scenes.has(c.sourceSceneId) || !scenes.has(c.targetSceneId))
        fail(
          'DANGLING_CONNECTION',
          `Connection ${c.id} has a missing endpoint.`,
          400,
          'Create its scenes or explicitly delete the incident connection in this batch.',
          c.id,
        );
  }
  private async snapshot(p: State) {
    const id = `${Date.now()}_${randomUUID()}.json`;
    await atomicWrite(join(this.folder(p.id), 'backups', id), p);
  }
  private async prune(id: string) {
    const dir = join(this.folder(id), 'backups');
    const entries = (await readdir(dir))
      .filter((x) => x.endsWith('.json'))
      .sort()
      .reverse();
    await Promise.all(entries.slice(20).map((x) => unlink(join(dir, x))));
  }
  async apply(input: unknown, dryRun = false): Promise<MutationResult> {
    return this.serial(async () => {
      const batch = Batch.parse(input);
      const p = await this.load(batch.projectId);
      const digest = hash(batch);
      const old = p.receipts.find((x) => x.id === batch.requestId);
      if (old) {
        if (old.hash !== digest)
          fail(
            'REQUEST_ID_REUSED',
            'This request ID was already used with different input.',
            409,
            'Choose a new requestId.',
          );
        return old.result;
      }
      if (p.contentRevision !== batch.expectedContentRevision)
        fail(
          'CONTENT_CONFLICT',
          `Expected revision ${batch.expectedContentRevision}; current revision is ${p.contentRevision}.`,
          409,
          'Read current project state and retry with a new request ID and updated revision.',
        );
      const next: State = structuredClone(p);
      const affected = new Set<string>();
      for (const [index, op] of batch.operations.entries()) {
        if (op.type === 'project.vision.set') {
          next.vision = op.vision;
          next.title = op.vision.name;
          continue;
        }
        const sceneOp = op.type.startsWith('scene.');
        const list = (sceneOp ? next.scenes : next.connections) as Array<
          Record<string, unknown> & { id: string }
        >;
        if (op.type === 'scene.create' || op.type === 'connection.create') {
          const entity = op.type === 'scene.create' ? op.scene : op.connection;
          if (list.some((x) => x.id === entity.id))
            fail(
              'DUPLICATE_ID',
              `${entity.id} already exists.`,
              409,
              'Use a patch operation to revise it.',
              `operations.${index}`,
            );
          list.push(entity);
          affected.add(entity.id);
        } else {
          const found = list.findIndex((x) => x.id === op.id);
          if (found < 0)
            fail(
              'NOT_FOUND',
              `${op.id} does not exist.`,
              404,
              'Read current project state.',
              `operations.${index}`,
            );
          if (op.type.endsWith('.delete')) {
            list.splice(found, 1);
            if (sceneOp) delete next.positions[op.id];
          } else if ('changes' in op)
            list[found] = { ...list[found], ...op.changes };
          affected.add(op.id);
        }
      }
      for (const op of batch.operations)
        if (
          op.type === 'scene.create' &&
          next.scenes.some((s) => s.id === op.scene.id)
        ) {
          const near = op.placement?.nearSceneId;
          if (near && !next.scenes.some((s) => s.id === near))
            fail('NOT_FOUND', `Placement scene ${near} does not exist.`);
          const anchor = near ? next.positions[near] : undefined;
          const point = {
            x: Math.min(99600, Math.max(-99600, anchor ? anchor.x + 400 : 0)),
            y: Math.min(99600, Math.max(-99600, anchor?.y ?? 0)),
          };
          let attempts = 0;
          while (
            Object.values(next.positions).some(
              (p) =>
                Math.abs(p.x - point.x) < 380 && Math.abs(p.y - point.y) < 420,
            )
          ) {
            point.y += 440;
            if (point.y > 99600) {
              point.y = -99600;
              point.x += 400;
              if (point.x > 99600) point.x = -99600;
            }
            if (++attempts > 250000)
              fail(
                'LAYOUT_FULL',
                'No free card position remains within the canvas bounds.',
              );
          }
          next.positions[op.scene.id] = point;
        }
      await this.validate(next);
      const result: MutationResult = {
        success: true,
        projectId: p.id,
        contentRevision: p.contentRevision + 1,
        affectedIds: [...affected],
        warnings: [],
      };
      if (dryRun) return { ...result, dryRun: true };
      next.contentRevision++;
      next.updatedAt = new Date().toISOString();
      next.receipts.push({ id: batch.requestId, hash: digest, result });
      next.receipts = next.receipts.slice(-100);
      await this.snapshot(p);
      await atomicWrite(join(this.folder(p.id), 'project.json'), next);
      await this.prune(p.id).catch(() =>
        result.warnings.push(
          'Backup retention cleanup failed; the update was saved.',
        ),
      );
      this.emit('change', {
        projectId: p.id,
        kind: 'content',
        affectedIds: result.affectedIds,
      });
      return result;
    });
  }
  async settings(id: string, input: unknown) {
    return this.serial(async () => {
      const settings = ProjectSettings.parse(input);
      const project = await this.load(id);
      if ((project.meshFoundryEnabled ?? false) === settings.meshFoundryEnabled)
        return;
      project.meshFoundryEnabled = settings.meshFoundryEnabled;
      await atomicWrite(join(this.folder(id), 'project.json'), project);
      this.emit('change', { projectId: id, kind: 'settings' });
    });
  }
  async layout(id: string, input: unknown) {
    return this.serial(async () => {
      const data = LayoutPatch.parse(input),
        p = await this.load(id);
      if (
        data.expectedContentRevision !== undefined &&
        p.contentRevision !== data.expectedContentRevision
      )
        fail(
          'CONTENT_CONFLICT',
          `Current content revision is ${p.contentRevision}.`,
          409,
          'Reread the storyboard and arrange the current scenes.',
        );
      if (p.layoutRevision !== data.expectedLayoutRevision)
        fail(
          'LAYOUT_CONFLICT',
          `Current layout revision is ${p.layoutRevision}.`,
          409,
          'Reread layout and retry only intended positions.',
        );
      for (const [sceneId, point] of Object.entries(data.positions)) {
        if (!p.scenes.some((s) => s.id === sceneId))
          fail('NOT_FOUND', `Scene ${sceneId} does not exist.`, 404);
        p.positions[sceneId] = point;
      }
      p.layoutRevision++;
      await atomicWrite(join(this.folder(id), 'project.json'), p);
      this.emit('change', { projectId: id, kind: 'layout' });
      return this.read(id);
    });
  }
  async viewport(id: string, input?: unknown) {
    await this.load(id);
    const file = join(this.folder(id), 'viewport.json');
    if (input === undefined) {
      try {
        return Viewport.parse(JSON.parse(await readFile(file, 'utf8')));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    }
    return this.serial(async () => {
      const view = Viewport.parse(input);
      await atomicWrite(file, view);
      return view;
    });
  }
  async backups(id: string) {
    await stat(this.folder(id)).catch(() =>
      fail('NOT_FOUND', 'Project folder does not exist.', 404),
    );
    const dir = join(this.folder(id), 'backups');
    await mkdir(dir, { recursive: true });
    return (await readdir(dir))
      .filter((x) => /^[a-zA-Z0-9_-]+\.json$/.test(x))
      .sort()
      .reverse();
  }
  async restore(id: string, input: unknown) {
    return this.serial(async () => {
      const data = Restore.parse(input);
      let p: State | undefined;
      try {
        p = await this.load(id);
      } catch (e) {
        if (
          !(e instanceof StudioError) ||
          e.code !== 'CORRUPT_PROJECT' ||
          !('recoverCorrupt' in data)
        )
          throw e;
      }
      if (p) {
        if ('recoverCorrupt' in data)
          fail(
            'RESTORE_CONFLICT',
            'Current project is readable; use both current revisions for a normal restore.',
            409,
          );
        if (
          p.contentRevision !== data.expectedContentRevision ||
          p.layoutRevision !== data.expectedLayoutRevision
        )
          fail(
            'RESTORE_CONFLICT',
            'Project changed since it was read.',
            409,
            'Read both current revisions before restoring.',
          );
      }
      let old: State;
      try {
        const raw = JSON.parse(
          await readFile(
            join(this.folder(id), 'backups', data.backupId),
            'utf8',
          ),
        );
        const { receipts: _receipts, ...project } = raw;
        old = { ...Project.parse(project), receipts: [] };
      } catch {
        fail('INVALID_BACKUP', 'The selected backup is missing or invalid.');
      }
      if (old!.id !== id)
        fail('INVALID_BACKUP', 'Backup belongs to another project.');
      // Retain imported assets and request receipts so retries cannot resurrect undone batches.
      const restored = {
        ...old!,
        meshFoundryEnabled: p ? p.meshFoundryEnabled : old!.meshFoundryEnabled,
        assets: { ...old!.assets, ...p?.assets },
        receipts: p?.receipts ?? [],
        contentRevision: p
          ? p.contentRevision + 1
          : Math.max(Date.now(), old!.contentRevision + 1),
        layoutRevision: p
          ? p.layoutRevision + 1
          : Math.max(Date.now(), old!.layoutRevision + 1),
        updatedAt: new Date().toISOString(),
      };
      await this.validate(restored);
      if (p) await this.snapshot(p);
      else {
        const file = join(
          this.folder(id),
          'recovery',
          `${Date.now()}_${randomUUID()}.corrupt`,
        );
        await mkdir(dirname(file), { recursive: true });
        await writeFile(
          file,
          await readFile(join(this.folder(id), 'project.json')),
          { mode: 0o600 },
        );
      }
      await atomicWrite(join(this.folder(id), 'project.json'), restored);
      await this.prune(id).catch(() => {});
      this.emit('change', {
        projectId: id,
        kind: 'content',
        affectedIds: restored.scenes.map((s) => s.id),
      });
      return this.read(id);
    });
  }
  async assetFile(id: string, assetId: string, thumbnail: boolean) {
    const p = await this.load(id),
      a = p.assets[Id.parse(assetId)];
    if (!a) fail('NOT_FOUND', 'Image not found.', 404);
    return join(this.folder(id), thumbnail ? a.thumbnailPath : a.path);
  }
}
export const parseBatch = (input: unknown): BatchData => Batch.parse(input);
