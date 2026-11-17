import { z } from 'zod';
import { Development, developmentOperations } from './development.js';
import { RehearsalEvent } from './rehearsal.js';

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
const BriefText = z.string().trim().min(1).max(4000);
const RehearsalBrief = z.strictObject({
  basis: z
    .strictObject({
      storyboardId: Id,
      contentRevision: z.number().int().nonnegative(),
    })
    .optional(),
  layout: BriefText,
  scenarios: z.array(BriefText).min(1).max(30),
  assets: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        decision: z.enum(['use', 'optional', 'leave out', 'missing']),
        rationale: BriefText,
        behavior: BriefText,
        source: z
          .strictObject({ libraryId: Id, assetId: Id, revisionId: Id })
          .optional(),
      }),
    )
    .max(100),
  gaps: z.array(BriefText).max(50),
});
const SceneStatusReport = z.strictObject({
  foundry: BriefText,
  rehearsal: BriefText,
  implementation: BriefText,
  next: BriefText,
});

export const Scene = z.strictObject({
  id: Id,
  title: z.string().trim().min(1).max(200),
  description: Text,
  notes: Text,
  mainAssetId: Id.nullable().optional(),
  supportingAssetIds: z.array(Id).max(30),
  selectedAssets: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        required: z.boolean(),
        source: RehearsalBrief.shape.assets.element.shape.source,
      }),
    )
    .max(100)
    .optional(),
  rehearsalBrief: RehearsalBrief.nullable().optional(),
  rehearsalEvents: z.array(RehearsalEvent).optional(),
  statusReport: SceneStatusReport.extend({
    checkedAt: z.iso.datetime(),
    inputRevision: z.number().int().nonnegative(),
  }).optional(),
});
export const Connection = z.strictObject({
  id: Id,
  sourceSceneId: Id,
  targetSceneId: Id,
  label: z.string().max(200).optional(),
});
const AssetKind = z.enum(['project-image', 'visualization']);
export const Asset = z.strictObject({
  id: Id,
  path: z.string(),
  thumbnailPath: z.string(),
  mediaType: z.string(),
  width: z.number(),
  height: z.number(),
  originalFilename: z.string(),
  kind: AssetKind.optional(),
});
export const ProjectVision = z.strictObject({
  name: z.string().trim().min(1).max(200),
  nameMeaning: Text,
  nameStatus: z.enum(['confirmed', 'provisional']),
  originalIdea: Text,
  summary: Text,
  purpose: Text,
  audience: Text,
  projectType: z.string().max(200),
  platforms: Text,
  coreExperience: Text,
  essentialFeatures: Text,
  exclusions: Text,
  creativePillars: Text,
  visualDirection: Text,
  visualizationAssetId: Id.optional(),
  constraints: Text,
  confirmedDecisions: Text,
  assumptions: Text,
  openQuestions: Text,
  references: z
    .array(
      z.strictObject({
        url: z
          .url()
          .refine(
            (value) => /^https?:\/\//.test(value),
            'Use an HTTP or HTTPS URL',
          ),
        relevance: z.string().max(2000),
      }),
    )
    .max(50),
  namingCheck: z.strictObject({
    checkedAt: z.iso.date().optional(),
    notes: Text,
  }),
});
export type ProjectVisionData = z.infer<typeof ProjectVision>;
const StoryboardName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}]+$/u);
export const CreateStoryboard = z.strictObject({ name: StoryboardName });
export const Storyboard = z.strictObject({
  projectId: Id,
  name: StoryboardName,
  sourceId: Id,
  sourceContentRevision: z.number().int().nonnegative(),
});
const AssetSuggestionDraft = z.strictObject({
  id: Id,
  name: z.string().trim().min(1).max(200),
  description: Text,
  explanation: Text,
  sceneIds: z.array(Id).min(1),
});
const AssetSuggestionResult = z.strictObject({
  libraryId: Id,
  assetId: Id,
  revisionId: Id,
});
const AssetSuggestion = AssetSuggestionDraft.extend({
  retired: z.literal(true).optional(),
  result: AssetSuggestionResult.extend({
    libraryVersion: z.number().int().nonnegative().optional(),
  }).optional(),
});
export const Project = z.strictObject({
  schemaVersion: z.literal(1),
  id: Id,
  title: z.string().trim().min(1).max(200),
  contentRevision: z.number().int().nonnegative(),
  rehearsalInputRevision: z.number().int().nonnegative().optional(),
  layoutRevision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  storyboard: Storyboard.optional(),
  vision: ProjectVision.optional(),
  meshFoundryEnabled: z.boolean().optional(),
  assetSuggestions: z.array(AssetSuggestion).optional(),
  development: Development.optional(),
  scenes: z.array(Scene),
  connections: z.array(Connection),
  assets: z.record(Id, Asset),
  positions: z.record(Id, Point),
});
const ScenePatch = Scene.omit({
  id: true,
  rehearsalEvents: true,
  statusReport: true,
})
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
  ...developmentOperations,
  z.strictObject({
    type: z.literal('rehearsal.record'),
    id: Id,
    afterEventId: Id.nullable(),
    event: RehearsalEvent,
  }),
  z.strictObject({
    type: z.literal('project.vision.set'),
    vision: ProjectVision,
  }),
  z.strictObject({
    type: z.literal('asset-suggestion.upsert'),
    suggestion: AssetSuggestionDraft,
  }),
  z.strictObject({
    type: z.literal('asset-suggestion.retire'),
    id: Id,
  }),
  z.strictObject({
    type: z.literal('asset-suggestion.result.set'),
    id: Id,
    result: AssetSuggestionResult.extend({
      libraryVersion: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    type: z.literal('scene.create'),
    scene: Scene.omit({ rehearsalEvents: true, statusReport: true }),
    placement: z.strictObject({ nearSceneId: Id }).optional(),
  }),
  z.strictObject({
    type: z.literal('scene.patch'),
    id: Id,
    changes: ScenePatch,
  }),
  z.strictObject({
    type: z.literal('scene.status.record'),
    id: Id,
    report: SceneStatusReport,
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
  skipSnapshot: z.literal(true).optional(),
  operations: z.array(Operation).min(1).max(1000),
});
export const ProjectSettings = z.strictObject({
  meshFoundryEnabled: z.boolean(),
});
export const LayoutPatch = z.strictObject({
  expectedContentRevision: z.number().int().nonnegative().optional(),
  expectedLayoutRevision: z.number().int().nonnegative(),
  positions: z.record(Id, Point).refine((v) => Object.keys(v).length > 0),
});
export const CreateProject = z.strictObject({
  id: Id.optional(),
  title: z.string().trim().min(1).max(200),
});
export const ImportAsset = z.strictObject({
  path: z.string().min(1),
  kind: AssetKind.optional(),
});
export type AssetKind = z.infer<typeof AssetKind>;
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
  createStoryboard: () => z.toJSONSchema(CreateStoryboard),
  createProject: () => z.toJSONSchema(CreateProject),
  importAsset: () => z.toJSONSchema(ImportAsset),
  restore: () => z.toJSONSchema(Restore),
  viewport: () => z.toJSONSchema(Viewport),
};

export type StoryboardSummary = {
  id: string;
  name: string;
  status: 'ready' | 'unreadable';
};

export type ProjectSummary =
  | {
      id: string;
      title: string;
      status: 'ready';
      sceneCount: number;
      updatedAt: string;
      storyboards?: StoryboardSummary[];
    }
  | {
      id: string;
      title: string;
      status: 'unreadable';
      error: ApiError;
      storyboards?: StoryboardSummary[];
    };
