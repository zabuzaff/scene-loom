import { OrchestrationRecord } from './orchestration.js';
import { z } from 'zod';

const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
const note = z.string().trim().min(1).max(8000);
const notes = z.array(note).min(1).max(100);
const revision = z.number().int().nonnegative();
export const Model = z.strictObject({
  libraryId: key,
  assetId: key,
  revisionId: key,
});
export const handoffLink = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS link.');
const Draft = z.strictObject({
  dataDir: note.regex(/^\//),
  port: z.number().int().min(1).max(65535),
  revisionId: key,
  link: note,
});
const Requirement = z.strictObject({
  id: key,
  name: note,
  source: Model,
  sourceLink: handoffLink.optional(),
  optional: z.boolean().optional(),
  objects: z.array(key).min(1).max(100),
  measurements: z
    .array(
      z.strictObject({ label: note, value: z.number().finite(), unit: note }),
    )
    .min(1)
    .max(100),
  changes: notes,
  preserve: notes,
  checks: notes,
});
const event = z.strictObject({ eventId: key });
export const RehearsalEvent = z.discriminatedUnion('kind', [
  OrchestrationRecord,
  event.extend({
    kind: z.literal('review'),
    inputRevision: revision,
    blockout: z.enum(['ready', 'needs-revision']),
    imports: z.enum(['ready', 'blocked', 'not-needed']),
    scope: note,
    findings: notes,
  }),
  event.extend({
    kind: z.literal('draft'),
    reviewId: key,
    parentRevisionId: key.nullable(),
    draft: Draft,
    requirements: z.array(Requirement).max(100),
    retireRequirementIds: z.array(key).max(100).optional(),
  }),
  event.extend({
    kind: z.literal('candidate'),
    requirementId: key,
    model: Model,
    basedOn: Model,
    modelLink: handoffLink.optional(),
    clearedReview: z
      .strictObject({
        ownerAcceptance: z.enum(['pending', 'unverified']),
        evidence: notes,
      })
      .optional(),
    adoptExisting: z.literal(true).optional(),
  }),
  event.extend({
    kind: z.literal('candidate-review'),
    requirementId: key,
    model: Model,
    verdict: z.enum(['accepted', 'needs-revision']),
    ownerOverride: z
      .strictObject({ rejectionEventId: key, reason: note })
      .optional(),
    evidence: notes,
  }),
  event.extend({
    kind: z.literal('fit'),
    requirementId: key,
    model: Model,
    rehearsalRevisionId: key,
    assembled: Draft.optional(),
    verdict: z.enum(['pass', 'model-defect', 'rehearsal-issue']),
    capabilityBlocker: note.optional(),
    evidence: notes,
  }),
]);
export type RehearsalEvent = z.infer<typeof RehearsalEvent>;
type Event<K> = Extract<RehearsalEvent, { kind: K }>;
type Requirement = z.infer<typeof Requirement>;
export type Model = z.infer<typeof Model>;
export type Handoff = {
  requirement: Requirement;
  measuredIn: Event<'draft'>['draft'];
  candidate?: Event<'candidate'>;
  acceptance?: Event<'candidate-review'>;
  fit?: Event<'fit'>;
};

export function rehearsalState(events: RehearsalEvent[] = []) {
  let review: Event<'review'> | undefined;
  let draft: Event<'draft'> | undefined;
  let head: Event<'draft'>['draft'] | undefined;
  const assets: Handoff[] = [];
  for (const item of events) {
    if (item.kind === 'orchestration') continue;
    if (item.kind === 'review') review = item;
    else if (item.kind === 'draft') {
      draft = item;
      head = item.draft;
      for (const id of item.retireRequirementIds ?? []) {
        const index = assets.findIndex(
          ({ requirement }) => requirement.id === id,
        );
        if (index !== -1) assets.splice(index, 1);
      }
      for (const requirement of item.requirements) {
        const index = assets.findIndex(
          (asset) =>
            asset.requirement.source.libraryId ===
              requirement.source.libraryId &&
            asset.requirement.source.assetId === requirement.source.assetId,
        );
        const entry = { requirement, measuredIn: item.draft };
        if (index === -1) assets.push(entry);
        else assets[index] = entry;
      }
    } else {
      const asset = assets.find(
        (asset) => asset.requirement.id === item.requirementId,
      );
      if (!asset) continue;
      if (item.kind === 'candidate') {
        asset.candidate = item.clearedReview
          ? { ...item, modelLink: item.modelLink ?? asset.candidate?.modelLink }
          : item;
        asset.acceptance = undefined;
        asset.fit = undefined;
      } else if (item.kind === 'candidate-review') {
        asset.acceptance = item;
        asset.fit = undefined;
      } else {
        asset.fit = item;
        head = item.assembled ?? head;
      }
    }
  }
  return { review, draft, head, assets };
}
export function sameModel(a: Model | undefined, b: Model) {
  return (
    a?.libraryId === b.libraryId &&
    a.assetId === b.assetId &&
    a.revisionId === b.revisionId
  );
}

export function workflowError(
  events: RehearsalEvent[],
  item: RehearsalEvent,
  inputRevision: number,
  hasBrief: boolean,
) {
  if (item.kind === 'orchestration') return 'Use orchestration validation.';
  if (events.some(({ kind }) => kind === 'orchestration'))
    return 'This scene now uses orchestration; legacy records are historical.';
  const { review, draft, head, assets } = rehearsalState(events);
  if (!hasBrief || events.some((event) => event.eventId === item.eventId))
    return 'A saved brief and unused event ID are required.';
  if (item.kind === 'review')
    return item.inputRevision === inputRevision
      ? undefined
      : 'The review inputs changed.';
  if (review?.inputRevision !== inputRevision || review.blockout !== 'ready')
    return 'A current review must clear blockout.';
  if (item.kind === 'draft') {
    const priorIds = new Set(
      events.flatMap((event) =>
        event.kind === 'draft' ? event.requirements.map(({ id }) => id) : [],
      ),
    );
    const sourceKeys = item.requirements.map(({ source }) =>
      JSON.stringify([source.libraryId, source.assetId]),
    );
    if (
      item.reviewId !== review.eventId ||
      item.parentRevisionId !== (head?.revisionId ?? null) ||
      (head && head.dataDir !== item.draft.dataDir) ||
      item.retireRequirementIds?.some(
        (id) => !assets.some(({ requirement }) => requirement.id === id),
      ) ||
      (!(
        head?.revisionId === item.draft.revisionId &&
        draft?.reviewId !== review.eventId
      ) &&
        events.some(
          (event) =>
            (event.kind === 'draft' &&
              event.draft.revisionId === item.draft.revisionId) ||
            (event.kind === 'fit' &&
              event.assembled?.revisionId === item.draft.revisionId),
        )) ||
      new Set(sourceKeys).size !== sourceKeys.length ||
      item.requirements.some(({ id }) => priorIds.has(id) || !priorIds.add(id))
    )
      return 'The draft must match the recorded head and current review, and use fresh requirement IDs and active retirement targets.';
    return;
  }
  if (draft?.reviewId !== review.eventId || !head)
    return 'Record a rehearsal under the current review first.';
  const asset = assets.find(
    ({ requirement }) => requirement.id === item.requirementId,
  );
  if (!asset) return 'The asset requirement was replaced or does not exist.';
  if (item.kind === 'candidate') {
    if (item.clearedReview) {
      if (
        !asset.candidate ||
        asset.acceptance ||
        item.adoptExisting ||
        !sameModel(asset.candidate.model, item.model) ||
        !sameModel(asset.candidate.model, item.basedOn) ||
        asset.candidate.clearedReview?.ownerAcceptance ===
          item.clearedReview.ownerAcceptance
      )
        return 'A cleared review must reassert the same pending candidate with a new owner acceptance state.';
      return;
    }
    const source = asset.candidate?.model ?? asset.requirement.source;
    if (
      !sameModel(source, item.basedOn) ||
      sameModel(asset.candidate?.model, item.model) ||
      (!item.adoptExisting &&
        sameModel(asset.requirement.source, item.model)) ||
      item.model.libraryId !== source.libraryId ||
      item.model.assetId !== source.assetId ||
      events.some(
        (event) =>
          event.kind === 'candidate' &&
          (event.requirementId === item.requirementId || !item.adoptExisting) &&
          sameModel(event.model, item.model),
      )
    )
      return 'The candidate must use the current Foundry base and a revision not yet reviewed for this requirement. Mark adoption of an existing model explicitly.';
  } else if (!sameModel(asset.candidate?.model, item.model))
    return 'The Foundry candidate changed.';
  else if (item.kind === 'candidate-review') {
    if (item.ownerOverride) {
      if (
        item.verdict !== 'accepted' ||
        asset.acceptance?.verdict !== 'needs-revision' ||
        asset.acceptance.eventId !== item.ownerOverride.rejectionEventId
      )
        return 'An owner override must accept the exact candidate and cite its current rejection.';
    } else if (asset.acceptance)
      return 'This candidate already has a review. Publish a new revision to resolve a rejection.';
  } else if (
    (item.capabilityBlocker && item.verdict !== 'rehearsal-issue') ||
    asset.acceptance?.verdict !== 'accepted' ||
    item.rehearsalRevisionId !== head.revisionId ||
    (item.assembled &&
      (item.assembled.dataDir !== head.dataDir ||
        events.some(
          (event) =>
            (event.kind === 'draft' &&
              event.draft.revisionId === item.assembled?.revisionId) ||
            (event.kind === 'fit' &&
              event.assembled?.revisionId === item.assembled?.revisionId),
        )))
  )
    return 'Fit evidence must target the accepted model and current rehearsal; any assembly must be a new revision in the same library.';
}
