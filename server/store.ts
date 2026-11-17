import { validateOrchestration } from './orchestration.js';
import {
  copyFile,
  mkdtemp,
  rm,
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
  planError,
  sceneDevelopment,
  sliceProgress,
} from '../shared/development.js';
import { verifyFoundryAcceptance } from './foundry.js';
import { workflowError } from '../shared/rehearsal.js';
import { BaselineName } from '../shared/storyboard.js';
import {
  Id,
  Project,
  Batch,
  CreateProject,
  CreateStoryboard,
  Storyboard,
  type StoryboardSummary,
  LayoutPatch,
  ProjectSettings,
  Restore,
  Viewport,
  type ProjectData,
  type BatchData,
  type AssetKind,
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
    if (project.storyboard) {
      try {
        project.title = (await this.load(project.storyboard.projectId)).title;
      } catch (error) {
        if (
          !(
            error instanceof StudioError &&
            ['NOT_FOUND', 'CORRUPT_PROJECT'].includes(error.code)
          ) &&
          (error as NodeJS.ErrnoException).code !== 'EACCES'
        )
          throw error;
      }
    }
    return project;
  }
  async list(): Promise<ProjectSummary[]> {
    const dir = join(this.root, 'projects');
    await mkdir(dir, { recursive: true });
    const entries = await readdir(dir, { withFileTypes: true });
    const entriesWithState = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && Id.safeParse(e.name).success)
        .map(
          async (
            e,
          ): Promise<{
            summary: ProjectSummary;
            storyboard?: ProjectData['storyboard'];
          }> => {
            try {
              const p = await this.load(e.name);
              return {
                storyboard: p.storyboard,
                summary: {
                  id: p.id,
                  title: p.title,
                  status: 'ready',
                  sceneCount: p.scenes.length,
                  updatedAt: p.updatedAt,
                },
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
              // The immutable identity survives damage to the mutable canvas.
              const identity = await readFile(
                join(this.folder(e.name), 'storyboard.json'),
                'utf8',
              )
                .then((raw) => Storyboard.parse(JSON.parse(raw)))
                .catch(() => undefined);
              return {
                storyboard: identity,
                summary: {
                  id: e.name,
                  title: e.name,
                  status: 'unreadable',
                  error: {
                    code: issue.code,
                    message: issue.message,
                    suggestion: issue.suggestion,
                  },
                },
              };
            }
          },
        ),
    );
    const storyboards = new Map<string, StoryboardSummary[]>();
    for (const { summary, storyboard } of entriesWithState) {
      if (!storyboard) continue;
      const siblings = storyboards.get(storyboard.projectId) ?? [];
      siblings.push({
        id: summary.id,
        name: storyboard.name,
        status: summary.status,
      });
      storyboards.set(storyboard.projectId, siblings);
    }
    return entriesWithState.flatMap(({ summary, storyboard }) => {
      if (storyboard) return [];
      const children = storyboards.get(summary.id);
      if (children) {
        summary.storyboards = children.sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      }
      return [summary];
    });
  }
  async createStoryboard(sourceId: string, input: unknown) {
    return this.serial(async () => {
      const { name } = CreateStoryboard.parse(input);
      const source = await this.load(sourceId);
      const projectId = source.storyboard?.projectId ?? sourceId;
      const project = (await this.list()).find((item) => item.id === projectId);
      if (project?.status !== 'ready')
        fail(
          'NOT_FOUND',
          'Recover the baseline before copying a storyboard.',
          404,
        );
      const names = [
        BaselineName,
        ...(project.storyboards ?? []).map((item) => item.name),
      ];
      if (
        names.some((existing) => existing.toLowerCase() === name.toLowerCase())
      )
        fail('ALREADY_EXISTS', 'A storyboard already uses this name.', 409);
      const id = `storyboard_${randomUUID()}`;
      const fork: State = {
        ...source,
        id,
        title: project.title,
        storyboard: {
          projectId,
          name,
          sourceId,
          sourceContentRevision: source.contentRevision,
        },
        assetSuggestions: source.assetSuggestions?.map(
          ({ result: _result, ...draft }) => draft,
        ),
        scenes: source.scenes.map(
          ({ rehearsalEvents: _events, statusReport: _status, ...scene }) =>
            scene,
        ),
        development: undefined,
        rehearsalInputRevision: 0,
        contentRevision: 0,
        layoutRevision: 0,
        receipts: [],
        updatedAt: new Date().toISOString(),
      };
      const staging = await mkdtemp(
        join(this.root, 'projects', '.storyboard-'),
      );
      try {
        await mkdir(join(staging, 'assets'));
        await mkdir(join(staging, 'thumbnails'));
        for (const [assetId, asset] of Object.entries(fork.assets)) {
          if (
            asset.id !== assetId ||
            asset.path !== `assets/${assetId}.webp` ||
            asset.thumbnailPath !== `thumbnails/${assetId}.webp`
          ) {
            fail(
              'INVALID_ASSET',
              'Restore the source storyboard asset manifest before copying.',
              409,
            );
          }
          for (const path of [
            asset.path,
            asset.thumbnailPath,
            `assets/${asset.id}.source`,
          ]) {
            await copyFile(
              join(this.folder(sourceId), path),
              join(staging, path),
            );
          }
        }
        await this.validate(fork, staging);
        await atomicWrite(join(staging, 'storyboard.json'), fork.storyboard);
        await atomicWrite(join(staging, 'project.json'), fork);
        await rename(staging, this.folder(id));
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      this.emit('change', { projectId, kind: 'projects' });
      return this.read(id);
    });
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
  async importAsset(id: string, path: string, kind?: AssetKind) {
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
      const existing = p.assets[assetId];
      const existingKind =
        p.vision?.visualizationAssetId === assetId
          ? 'visualization'
          : existing?.kind;
      if (kind && existingKind && kind !== existingKind)
        fail(
          'ASSET_KIND_CONFLICT',
          'These image bytes already have a different asset kind.',
        );
      const assetKind = existingKind ?? kind;
      if (
        assetKind === 'visualization' &&
        p.scenes.some(
          (scene) =>
            scene.mainAssetId === assetId ||
            scene.supportingAssetIds.includes(assetId),
        )
      )
        fail(
          'ASSET_KIND_CONFLICT',
          'These image bytes are already attached to a scene.',
        );
      if (existing) {
        const complete = await Promise.all(
          [
            existing.path,
            existing.thumbnailPath,
            `assets/${assetId}.source`,
          ].map((file) =>
            stat(join(this.folder(id), file)).then(
              () => true,
              () => false,
            ),
          ),
        );
        if (complete.every(Boolean)) {
          if (existing.kind === assetKind) return existing;
          const classified = { ...existing, kind: assetKind };
          p.assets[assetId] = classified;
          await atomicWrite(join(this.folder(id), 'project.json'), p);
          return classified;
        }
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
        kind: assetKind,
      };
      p.assets[assetId] = asset;
      await atomicWrite(join(dir, 'project.json'), p);
      return asset;
    });
  }
  private async validate(
    p: State,
    folder = this.folder(p.id),
    previous?: State,
  ) {
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
    if (p.development) {
      const problem = planError(p.development.plan, scenes);
      if (problem) fail('INVALID_DEVELOPMENT_PLAN', problem);
    }
    const suggestions = p.assetSuggestions ?? [];
    if (
      new Set(suggestions.map((suggestion) => suggestion.id)).size !==
      suggestions.length
    )
      fail('DUPLICATE_ID', 'Asset suggestion IDs must be unique.');
    for (const suggestion of suggestions)
      if (
        new Set(suggestion.sceneIds).size !== suggestion.sceneIds.length ||
        (!suggestion.retired &&
          suggestion.sceneIds.some((id) => !scenes.has(id)))
      )
        fail(
          'INVALID_SCENE_LINKS',
          'Asset suggestions must link to distinct existing scenes.',
        );
    const visualizationId = p.vision?.visualizationAssetId;
    const checkImage = async (id: string, owner: string, sceneId?: string) => {
      const asset = p.assets[id];
      if (!asset)
        fail(
          'MISSING_ASSET',
          `${owner} references unimported image ${id}.`,
          400,
          'Import the image, then use the returned asset ID.',
          sceneId,
        );
      await stat(join(folder, asset.path)).catch(() =>
        fail(
          'MISSING_ASSET',
          `Stored image ${id} is missing.`,
          400,
          'Restore the missing project asset.',
          sceneId,
        ),
      );
      return asset;
    };
    if (visualizationId) {
      const asset = await checkImage(visualizationId, 'Project Vision');
      if (
        previous &&
        visualizationId !== previous.vision?.visualizationAssetId &&
        asset.kind !== 'visualization'
      )
        fail(
          'INVALID_ASSET_KIND',
          'Import the Project Vision image with kind visualization.',
        );
    }
    const previousScenes = new Map(
      previous?.scenes.map((scene) => [scene.id, scene]),
    );

    for (const scene of p.scenes) {
      const imageIds = scene.mainAssetId
        ? [scene.mainAssetId, ...scene.supportingAssetIds]
        : scene.supportingAssetIds;
      const priorScene = previousScenes.get(scene.id);
      for (const id of imageIds) {
        if (id === visualizationId)
          fail(
            'VISION_IMAGE_IN_SCENE',
            'The approved visualization belongs to Project Vision.',
            400,
            'Use real project imagery for scene attachments.',
            scene.id,
          );
        const asset = await checkImage(id, `Scene ${scene.id}`, scene.id);
        const alreadyAttached =
          priorScene?.mainAssetId === id ||
          priorScene?.supportingAssetIds.includes(id);
        if (
          asset.kind === 'visualization' ||
          (previous && !alreadyAttached && asset.kind !== 'project-image')
        )
          fail(
            'INVALID_ASSET_KIND',
            `Scene ${scene.id} requires real project imagery for new attachments.`,
            400,
            'Import a verified screenshot or actual project asset with kind project-image.',
            scene.id,
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
      if (batch.skipSnapshot) {
        const [operation] = batch.operations;
        const selection =
          operation.type === 'scene.patch' &&
          operation.changes.selectedAssets !== undefined &&
          Object.keys(operation.changes).length === 1;
        const sync =
          operation.type === 'rehearsal.record' &&
          operation.event.kind === 'orchestration' &&
          operation.event.record.stage === 'sync';
        if (batch.operations.length !== 1 || (!selection && !sync))
          fail(
            'VALIDATION_ERROR',
            'Skipping the snapshot requires a single asset selection or orchestration sync.',
            400,
          );
      }
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
      const priorVisualizationId = p.vision?.visualizationAssetId;
      const priorVisualization = priorVisualizationId
        ? next.assets[priorVisualizationId]
        : undefined;
      if (priorVisualization && !priorVisualization.kind)
        priorVisualization.kind = 'visualization';
      const rehearsalOnly = batch.operations.every(
        (op) => op.type === 'rehearsal.record',
      );
      const developmentOnly =
        batch.operations.length === 1 &&
        batch.operations[0].type.startsWith('development.');
      const statusOnly =
        batch.operations.length === 1 &&
        batch.operations[0].type === 'scene.status.record';
      const workflowOnly = rehearsalOnly || developmentOnly || statusOnly;
      if (
        !statusOnly &&
        batch.operations.some((op) => op.type === 'scene.status.record')
      )
        fail(
          'MIXED_SCENE_STATUS_BATCH',
          'Record scene status separately from other changes.',
          409,
        );
      if (
        !developmentOnly &&
        batch.operations.some((op) => op.type.startsWith('development.'))
      )
        fail(
          'MIXED_DEVELOPMENT_BATCH',
          'Submit one development operation in its own batch.',
        );
      if (
        !workflowOnly &&
        batch.operations.some((op) => op.type === 'rehearsal.record')
      )
        fail(
          'MIXED_REHEARSAL_BATCH',
          'Record rehearsal events separately from storyboard edits.',
        );
      const affected = new Set<string>();
      const updatedDrafts = new Set<string>();
      for (const [index, op] of batch.operations.entries()) {
        if (op.type === 'development.plan.set') {
          const previous = next.development;
          if (previous && hash(previous.plan) === hash(op.plan))
            fail(
              'UNCHANGED_DEVELOPMENT_PLAN',
              'The same plan is already mapped. Review the saved mapping.',
            );
          const active = previous?.plan.slices.find(
            ({ id }) => sliceProgress(previous, id).claimId,
          );
          if (active)
            fail(
              'DEVELOPMENT_ACTIVE_CLAIM',
              `Checkpoint the active slice "${active.name}" before replacing the plan.`,
              409,
            );
          next.development = {
            plan: op.plan,
            planRevision: p.contentRevision + 1,
            records: previous?.records ?? [],
            priorPlans: previous
              ? [
                  ...(previous.priorPlans ?? []),
                  {
                    plan: previous.plan,
                    planRevision: previous.planRevision,
                    review: previous.review,
                  },
                ]
              : [],
          };
          for (const slice of [
            ...op.plan.slices,
            ...(previous?.plan.slices ?? []),
          ])
            slice.sceneIds.forEach((id) => affected.add(id));
          continue;
        }
        if (
          op.type === 'development.plan.review' ||
          op.type === 'development.start' ||
          op.type === 'development.checkpoint'
        ) {
          const development = next.development;
          if (!development || development.planRevision !== op.planRevision)
            fail(
              'STALE_DEVELOPMENT',
              'The plan mapping changed. Read the current storyboard.',
              409,
            );
          if (
            op.type !== 'development.checkpoint' &&
            !development.plan.repository
          )
            fail(
              'DEVELOPMENT_REPOSITORY_REQUIRED',
              'Remap the plan with its repository identity and review it again.',
              409,
            );
          if (op.type === 'development.plan.review') {
            if (development.review?.verdict === 'ready')
              fail(
                'STALE_DEVELOPMENT',
                'This mapping is already reviewed. Map revised plan files before re-review.',
                409,
              );
            development.review = op.review;
            for (const slice of development.plan.slices)
              slice.sceneIds.forEach((id) => affected.add(id));
            continue;
          }
          if (development.review?.verdict !== 'ready')
            fail(
              'DEVELOPMENT_REVIEW_REQUIRED',
              'An independent Ready review is required.',
              409,
            );
          const slice = development.plan.slices.find(
            ({ id }) => id === op.sliceId,
          );
          if (!slice)
            fail('STALE_DEVELOPMENT', 'The slice is no longer mapped.', 409);
          const current = sliceProgress(development, slice.id);
          const { planRevision, sliceId, claimId } = op;
          if (op.type === 'development.start') {
            const target = sceneDevelopment(
              development,
              op.sceneId,
              sliceId,
            )?.next;
            if (
              target?.id !== sliceId ||
              target.prerequisite ||
              current.afterClaimId !== op.afterClaimId ||
              current.claimId !== op.replacesClaimId ||
              current.status === 'verified' ||
              development.records.some((record) => record.claimId === claimId)
            )
              fail(
                'DEVELOPMENT_NOT_READY',
                'Use the current scene action. The slice is claimed, complete, or waiting for a prerequisite.',
                409,
              );
            development.records.push({
              kind: 'start',
              planRevision,
              sliceId,
              claimId,
            });
          } else {
            if (current.claimId !== claimId)
              fail(
                'STALE_DEVELOPMENT',
                'This checkpoint does not own the current development claim.',
                409,
              );
            if (
              (op.checkpoint.status === 'verified' &&
                !op.checkpoint.evidence.length) ||
              (op.checkpoint.status === 'blocked' && !op.checkpoint.blocker)
            )
              fail(
                'MISSING_DEVELOPMENT_EVIDENCE',
                'Verified needs evidence; Blocked needs a blocker.',
              );
            development.records.push({
              kind: 'checkpoint',
              planRevision,
              sliceId,
              claimId,
              checkpoint: op.checkpoint,
            });
          }
          slice.sceneIds.forEach((id) => affected.add(id));
          continue;
        }
        if (op.type === 'scene.status.record') {
          const scene = next.scenes.find(({ id }) => id === op.id);
          if (!scene) fail('NOT_FOUND', 'Scene does not exist.', 404);
          scene.statusReport = {
            ...op.report,
            checkedAt: new Date().toISOString(),
            inputRevision: p.rehearsalInputRevision ?? p.contentRevision,
          };
          affected.add(op.id);
          continue;
        }
        if (op.type === 'rehearsal.record') {
          if (!p.meshFoundryEnabled)
            fail(
              'HANDOFF_DISABLED',
              'Enable Mesh Foundry handoff for this storyboard.',
              403,
            );
          const scene = next.scenes.find(({ id }) => id === op.id);
          if (!scene) fail('NOT_FOUND', 'Scene does not exist.', 404);
          const events = (scene.rehearsalEvents ??= []);
          if ((events.at(-1)?.eventId ?? null) !== op.afterEventId)
            fail(
              'STALE_REHEARSAL',
              'The scene handoff changed. Reread before recording evidence.',
              409,
            );
          if (op.event.kind === 'orchestration') {
            if (batch.operations.length !== 1)
              fail(
                'MIXED_REHEARSAL_BATCH',
                'Record one orchestration event per batch.',
              );
            await validateOrchestration(p, scene, op.event);
            events.push(op.event);
            affected.add(op.id);
            continue;
          }
          const error = workflowError(
            events,
            op.event,
            p.rehearsalInputRevision ?? p.contentRevision,
            !!scene.rehearsalBrief,
          );
          if (error) fail('STALE_REHEARSAL', error, 409);
          if (op.event.kind === 'candidate-review' && op.event.ownerOverride) {
            const accepted = await verifyFoundryAcceptance(
              op.event.model,
            ).catch(() =>
              fail(
                'FOUNDRY_UNAVAILABLE',
                'Could not verify current owner acceptance in Mesh Foundry.',
                503,
              ),
            );
            if (!accepted)
              fail(
                'FOUNDRY_NOT_ACCEPTED',
                'Mesh Foundry must currently accept this exact eligible model revision.',
                409,
              );
          }
          events.push(op.event);
          affected.add(op.id);
          continue;
        }
        if (op.type === 'project.vision.set') {
          next.vision = op.vision;
          if (!next.storyboard) next.title = op.vision.name;
          continue;
        }
        if (
          op.type === 'asset-suggestion.upsert' ||
          op.type === 'asset-suggestion.retire' ||
          op.type === 'asset-suggestion.result.set'
        ) {
          if (p.meshFoundryEnabled !== true)
            fail(
              'HANDOFF_DISABLED',
              'Enable Mesh Foundry handoff for this storyboard.',
              403,
            );
          const suggestions = (next.assetSuggestions ??= []);
          const id =
            op.type === 'asset-suggestion.upsert' ? op.suggestion.id : op.id;
          const prior = suggestions.find((suggestion) => suggestion.id === id);
          if (prior?.retired && op.type !== 'asset-suggestion.retire')
            fail('SUGGESTION_RETIRED', 'Use a new ID for a new draft.', 409);
          if (op.type === 'asset-suggestion.upsert') {
            updatedDrafts.add(id);
            if (prior) Object.assign(prior, op.suggestion);
            else suggestions.push(op.suggestion);
          } else {
            if (!prior)
              fail('NOT_FOUND', 'Asset suggestion does not exist.', 404);
            if (op.type === 'asset-suggestion.retire') {
              prior.retired = true;
            } else {
              const previous = prior.result;
              if (
                previous?.libraryVersion !== undefined &&
                (previous.libraryId !== op.result.libraryId ||
                  previous.libraryVersion > op.result.libraryVersion ||
                  (previous.libraryVersion === op.result.libraryVersion &&
                    (previous.assetId !== op.result.assetId ||
                      previous.revisionId !== op.result.revisionId)))
              )
                fail(
                  'STALE_ASSET_RESULT',
                  'Reread the current Mesh Foundry pin before writing back.',
                  409,
                );
              prior.result = op.result;
            }
          }
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
      const deletedScenes = new Set(
        batch.operations.flatMap((op) =>
          op.type === 'scene.delete' ? [op.id] : [],
        ),
      );
      if (deletedScenes.size && next.assetSuggestions) {
        const remaining = new Set(next.scenes.map((scene) => scene.id));
        next.assetSuggestions = next.assetSuggestions
          .map((suggestion) =>
            suggestion.retired || updatedDrafts.has(suggestion.id)
              ? suggestion
              : {
                  ...suggestion,
                  sceneIds: suggestion.sceneIds.filter(
                    (id) => !deletedScenes.has(id) || remaining.has(id),
                  ),
                },
          )
          .filter((suggestion) => suggestion.sceneIds.length);
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
      await this.validate(next, this.folder(p.id), p);
      const unchangedResults =
        batch.operations.every(
          (op) => op.type === 'asset-suggestion.result.set',
        ) && hash(next.assetSuggestions) === hash(p.assetSuggestions);
      const result: MutationResult = {
        success: true,
        projectId: p.id,
        contentRevision: p.contentRevision + (unchangedResults ? 0 : 1),
        affectedIds: [...affected],
        warnings: [],
      };
      if (dryRun) return { ...result, dryRun: true };
      if (unchangedResults) return result;
      next.contentRevision++;
      next.rehearsalInputRevision = workflowOnly
        ? (p.rehearsalInputRevision ?? p.contentRevision)
        : next.contentRevision;
      next.updatedAt = new Date().toISOString();
      next.receipts.push({ id: batch.requestId, hash: digest, result });
      next.receipts = next.receipts.slice(-100);
      const reset = batch.operations.some(
        (op) =>
          op.type === 'rehearsal.record' &&
          op.event.kind === 'orchestration' &&
          op.event.record.stage === 'sync' &&
          op.event.record.legacyReset,
      );
      const shouldSnapshot = !reset && !batch.skipSnapshot;
      if (shouldSnapshot) await this.snapshot(p);
      await atomicWrite(join(this.folder(p.id), 'project.json'), next);
      if (shouldSnapshot)
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
      restored.rehearsalInputRevision = restored.contentRevision;
      if (restored.development) {
        const development = restored.development;
        restored.development = {
          ...development,
          planRevision: restored.contentRevision,
          review: undefined,
          priorPlans: [
            ...(development.priorPlans ?? []),
            {
              plan: development.plan,
              planRevision: development.planRevision,
              review: development.review,
            },
          ],
        };
      }
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
