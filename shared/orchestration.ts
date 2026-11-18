import { z } from 'zod';

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
  ]),
});
export type OrchestrationRecord = z.infer<typeof OrchestrationRecord>;
type RecordAt<S> = Extract<OrchestrationRecord['record'], { stage: S }> & {
  eventId: string;
};
export type OrchestrationAction = 'sync' | 'plan' | 'publish' | 'handoff';

export function orchestrationState(
  events: { kind: string }[] = [],
  inputRevision: number,
) {
  let sync: RecordAt<'sync'> | undefined;
  let plan: RecordAt<'plan'> | undefined;
  let decision: RecordAt<'decision'> | undefined;
  let draft: RecordAt<'publication'> | RecordAt<'draft'> | undefined;
  let review: RecordAt<'draft-review'> | undefined;
  for (const event of events) {
    if (event.kind !== 'orchestration') continue;
    const { record, eventId } = event as OrchestrationRecord;
    switch (record.stage) {
      case 'sync':
        sync = { ...record, eventId };
        plan = decision = draft = review = undefined;
        break;
      case 'plan':
        plan = { ...record, eventId };
        decision = draft = review = undefined;
        break;
      case 'decision':
        decision = { ...record, eventId };
        break;
      case 'draft':
      case 'publication':
        draft = { ...record, eventId };
        review = undefined;
        break;
      case 'draft-review':
        review = { ...record, eventId };
        break;
    }
  }
  const current = sync?.inputRevision === inputRevision;
  // The owner agrees to a plan in chat, and accepts the draft in Rehearsal.
  // Older decision, publication and review records stay as history only.
  const next: OrchestrationAction | 'resolve' =
    !current || !sync
      ? 'sync'
      : sync.entries.some(({ required, source }) => required && !source)
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
    next,
    current,
    draftId,
    draftUrl,
  };
}
