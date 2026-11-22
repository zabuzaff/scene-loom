import { z } from 'zod';

// Structural equality that ignores key order (shared with the browser).
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((k) => x[k] !== undefined);
  return (
    keys.length === Object.keys(y).filter((k) => y[k] !== undefined).length &&
    keys.every((k) => same(x[k], y[k]))
  );
};

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
const note = z.string().trim().min(1).max(8000);
const notes = z.array(note).min(1).max(100);
const cue = note.max(2000);
const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const hex = z.string().regex(/^[a-f0-9]{8,128}$/i);
const model = z.strictObject({ libraryId: id, assetId: id, revisionId: id });
export const ManifestEntry = z.strictObject({
  name: note,
  required: z.boolean(),
  source: model.optional(),
  pinnedSource: model.optional(),
  issue: note.optional(),
});
const base = z.strictObject({ eventId: id, kind: z.literal('orchestration') });
export const Plan = z.strictObject({
  intent: cue,
  pieces: z
    .array(
      z.strictObject({
        id,
        label: note.max(80),
        source: model.optional(),
        group: id.optional(),
        position: vector,
        size: vector,
        scale: vector,
        rotation: vector,
        behavior: cue,
      }),
    )
    .min(1)
    .max(100),
  cameraOrTraversal: z.array(cue).min(1).max(40),
  checks: z.array(cue).min(1).max(40),
  references: z.array(note).max(100),
});

const label = note.max(200);
// Structured evidence an in-game reviewer attaches to a game review. Every
// field is optional so a changes-requested review can carry findings alone.
export const GameReviewEvidence = z.strictObject({
  propCaptures: z
    .array(z.strictObject({ piece: label, captureRef: note }))
    .max(200)
    .optional(),
  scaleChecks: z
    .array(z.strictObject({ piece: label, against: label, result: note }))
    .max(200)
    .optional(),
  clipChecks: z
    .array(
      z.strictObject({
        piece: label,
        clip: label,
        action: label,
        result: note,
      }),
    )
    .max(200)
    .optional(),
});
export type GameReviewEvidence = z.infer<typeof GameReviewEvidence>;
export const evidenceCategories = [
  'propCaptures',
  'scaleChecks',
  'clipChecks',
] as const;
export function evidenceCounts(evidence?: GameReviewEvidence) {
  return {
    propCaptures: evidence?.propCaptures?.length ?? 0,
    scaleChecks: evidence?.scaleChecks?.length ?? 0,
    clipChecks: evidence?.clipChecks?.length ?? 0,
  };
}
// Categories a passing review still lacks.
export const missingEvidence = (evidence?: GameReviewEvidence) =>
  evidenceCategories.filter((key) => !evidenceCounts(evidence)[key]);

export const OrchestrationRecord = base.extend({
  record: z.discriminatedUnion('stage', [
    z.strictObject({
      stage: z.literal('sync'),
      inputRevision: z.number().int().nonnegative(),
      libraryId: id,
      entries: z.array(ManifestEntry).max(100),
      legacyReset: z.literal(true).optional(),
    }),
    z.strictObject({
      stage: z.literal('plan'),
      syncId: id,
      planner: note,
      plan: Plan,
    }),
    z.strictObject({
      stage: z.literal('decision'),
      planId: id,
      verdict: z.enum(['approved', 'changes-requested']),
      feedback: note.optional(),
    }),
    z.strictObject({
      stage: z.literal('draft'),
      builder: note,
      url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{4,5}$/),
      draftId: digest,
      scenarioId: id,
      // Rehearsal export digests that detect a stale draft. Optional so
      // records written before these fields existed still validate.
      contentDigest: hex.optional(),
      specDigest: hex.optional(),
    }),
    z.strictObject({
      stage: z.literal('owner-resolution'),
      syncId: id,
      // The selection the owner resolved, as it stood in the manifest.
      name: note,
      // Exact revision the owner chose; absent when the owner waives it.
      source: model.optional(),
      // The manifest entry as it stood before, kept as history.
      prior: ManifestEntry,
      reason: note.optional(),
    }),
    z.strictObject({
      stage: z.literal('publication'),
      builder: note,
      approvalId: id,
      dataDir: note.regex(/^\//),
      port: z.number().int().min(1).max(65535),
      revisionId: digest,
      parent: digest.nullable(),
      scenarioId: id,
    }),
    z.strictObject({
      stage: z.literal('draft-review'),
      publicationId: id,
      reviewer: note,
      verdict: z.enum([
        'approved',
        'changes-requested',
        'plan-changes-requested',
      ]),
      findings: notes,
    }),
    z.strictObject({
      stage: z.literal('game-review'),
      // The Rehearsal draft the implementation was reviewed against.
      draftId: digest,
      reviewer: note,
      // Exact running build and route that were inspected.
      build: note,
      route: note,
      verdict: z.enum(['ready', 'changes-requested']),
      findings: notes,
      // Optional in the schema so older records load; a ready verdict
      // requires all three categories when it is recorded.
      evidence: GameReviewEvidence.optional(),
    }),
  ]),
});
export type OrchestrationRecord = z.infer<typeof OrchestrationRecord>;
type RecordAt<S> = Extract<OrchestrationRecord['record'], { stage: S }> & {
  eventId: string;
};
export type OrchestrationAction = 'sync' | 'plan' | 'publish' | 'handoff';
export type ManifestEntry = z.infer<typeof ManifestEntry>;
// An entry as it stands after the owner's resolutions. `ownerResolved` is the
// resolving event ID; it is never stored inside a sync record.
export type EffectiveEntry = ManifestEntry & { ownerResolved?: string };
export type Resolution = {
  eventId: string;
  // The sync it was made against, and the manifest entry it resolved.
  syncId: string;
  prior: ManifestEntry;
  source?: z.infer<typeof model>;
};

export const nameKey = (name: string) => name.trim().toLowerCase();

// Owner authority fills only gaps. Where Foundry currently supplies an
// exact accepted source, Foundry's answer stands.
export function overlayResolutions(
  entries: ManifestEntry[],
  resolutions: ReadonlyMap<string, Resolution>,
  syncId: string | undefined,
): EffectiveEntry[] {
  return entries.map((entry) => {
    const resolution = resolutions.get(nameKey(entry.name));
    // A resolution applies only to the sync it was made against, or to an
    // entry still identical to the one the owner resolved.
    if (
      !resolution ||
      entry.source ||
      !(resolution.syncId === syncId || same(resolution.prior, entry))
    )
      return entry;
    const { issue: _issue, ...rest } = entry;
    return {
      ...rest,
      ...(resolution.source ? { source: resolution.source } : {}),
      ownerResolved: resolution.eventId,
    };
  });
}

export const unresolved = (entry: EffectiveEntry) =>
  entry.required && !entry.source && !entry.ownerResolved;

export function orchestrationState(
  events: { kind: string }[] = [],
  inputRevision: number,
) {
  let sync: RecordAt<'sync'> | undefined;
  let plan: RecordAt<'plan'> | undefined;
  let decision: RecordAt<'decision'> | undefined;
  let draft: RecordAt<'publication'> | RecordAt<'draft'> | undefined;
  let review: RecordAt<'draft-review'> | undefined;
  let gameReview: RecordAt<'game-review'> | undefined;
  const resolutions = new Map<string, Resolution>();
  for (const event of events) {
    if (event.kind !== 'orchestration') continue;
    const { record, eventId } = event as OrchestrationRecord;
    switch (record.stage) {
      case 'sync':
        sync = { ...record, eventId };
        plan = decision = draft = review = gameReview = undefined;
        break;
      case 'plan':
        plan = { ...record, eventId };
        decision = draft = review = gameReview = undefined;
        break;
      case 'owner-resolution':
        // Scoped to its sync (or an identical entry) and only to entries that
        // still lack an accepted source, so Foundry's answer wins once it
        // exists. A later resolution supersedes an earlier one.
        resolutions.set(nameKey(record.name), {
          eventId,
          syncId: record.syncId,
          prior: record.prior,
          source: record.source,
        });
        break;
      case 'decision':
        decision = { ...record, eventId };
        break;
      case 'draft':
      case 'publication':
        draft = { ...record, eventId };
        review = gameReview = undefined;
        break;
      case 'draft-review':
        review = { ...record, eventId };
        break;
      case 'game-review':
        gameReview = { ...record, eventId };
        break;
    }
  }
  const current = sync?.inputRevision === inputRevision;
  // The owner agrees to a plan in chat, and accepts the draft in Rehearsal.
  // Older decision, publication and review records stay as history only.
  const entries = sync
    ? overlayResolutions(sync.entries, resolutions, sync.eventId)
    : [];
  const next: OrchestrationAction | 'resolve' =
    !current || !sync
      ? 'sync'
      : entries.some(unresolved)
        ? 'resolve'
        : !plan
          ? 'plan'
          : !draft
            ? 'publish'
            : 'handoff';
  const draftId = draft
    ? draft.stage === 'draft'
      ? draft.draftId
      : draft.revisionId
    : undefined;
  const draftUrl = draft
    ? `${draft.stage === 'draft' ? draft.url : `http://127.0.0.1:${draft.port}`}/revision/${draftId}/${draft.scenarioId}`
    : undefined;
  return {
    sync,
    plan,
    decision,
    draft,
    review,
    gameReview,
    next,
    current,
    entries,
    resolutions,
    draftId,
    draftUrl,
  };
}
