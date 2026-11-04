import { z } from 'zod';

export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
const Text = z.string().max(50000);
export const Point = z.strictObject({
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
});
export const Viewport = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().min(0.1).max(2),
});
export const Scene = z.strictObject({
  id: Id,
  title: z.string().trim().min(1).max(200),
  description: Text,
  notes: Text,
  mainAssetId: Id,
  supportingAssetIds: z.array(Id).max(30),
});
export const Connection = z.strictObject({
  id: Id,
  sourceSceneId: Id,
  targetSceneId: Id,
  label: z.string().max(200).optional(),
});
export const Asset = z.strictObject({
  id: Id,
  path: z.string(),
  thumbnailPath: z.string(),
  mediaType: z.string(),
  width: z.number(),
  height: z.number(),
  originalFilename: z.string(),
});
export const Project = z.strictObject({
  schemaVersion: z.literal(1),
  id: Id,
  title: z.string().trim().min(1).max(200),
  contentRevision: z.number().int().nonnegative(),
  layoutRevision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  scenes: z.array(Scene),
  connections: z.array(Connection),
  assets: z.record(Id, Asset),
  positions: z.record(Id, Point),
});
const ScenePatch = Scene.omit({ id: true })
  .partial()
  .refine(
    (v) => Object.keys(v).length > 0,
    'Provide at least one changed field',
  );
const ConnectionPatch = Connection.omit({ id: true })
  .partial()
  .refine(
    (v) => Object.keys(v).length > 0,
    'Provide at least one changed field',
  );
export const Operation = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('scene.create'),
    scene: Scene,
    placement: z.strictObject({ nearSceneId: Id }).optional(),
  }),
  z.strictObject({
    type: z.literal('scene.patch'),
    id: Id,
    changes: ScenePatch,
  }),
  z.strictObject({ type: z.literal('scene.delete'), id: Id }),
  z.strictObject({
    type: z.literal('connection.create'),
    connection: Connection,
  }),
  z.strictObject({
    type: z.literal('connection.patch'),
    id: Id,
    changes: ConnectionPatch,
  }),
  z.strictObject({ type: z.literal('connection.delete'), id: Id }),
]);
export const Batch = z.strictObject({
  schemaVersion: z.literal(1),
  projectId: Id,
  requestId: Id,
  expectedContentRevision: z.number().int().nonnegative(),
  operations: z.array(Operation).min(1).max(1000),
});
export const LayoutPatch = z.strictObject({
  expectedLayoutRevision: z.number().int().nonnegative(),
  positions: z.record(Id, Point).refine((v) => Object.keys(v).length > 0),
});
export const CreateProject = z.strictObject({
  id: Id.optional(),
  title: z.string().trim().min(1).max(200),
});
export const ImportAsset = z.strictObject({ path: z.string().min(1) });
const BackupId = z.string().regex(/^[a-zA-Z0-9_-]+\.json$/);
export const Restore = z.union([
  z.strictObject({
    backupId: BackupId,
    expectedContentRevision: z.number().int().nonnegative(),
    expectedLayoutRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({ backupId: BackupId, recoverCorrupt: z.literal(true) }),
]);
export type SceneData = z.infer<typeof Scene>;
export type ProjectData = z.infer<typeof Project>;
export type BatchData = z.infer<typeof Batch>;
export type PointData = z.infer<typeof Point>;
export type ViewportData = z.infer<typeof Viewport>;
export type ApiError = {
  code: string;
  message: string;
  location?: string;
  suggestion: string;
};
export const schemas = {
  batch: () => z.toJSONSchema(Batch),
  project: () => z.toJSONSchema(Project),
  layout: () => z.toJSONSchema(LayoutPatch),
  createProject: () => z.toJSONSchema(CreateProject),
  importAsset: () => z.toJSONSchema(ImportAsset),
  restore: () => z.toJSONSchema(Restore),
  viewport: () => z.toJSONSchema(Viewport),
};

export type ProjectSummary =
  | {
      id: string;
      title: string;
      status: 'ready';
      sceneCount: number;
      updatedAt: string;
    }
  | { id: string; title: string; status: 'unreadable'; error: ApiError };
