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
// review, draft, candidate, candidate-review and fit belong to the retired
// Rehearsal/Foundry fit loop. They stay in this union only so projects saved
// earlier still load and validate; the service rejects new ones.
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
export type Model = z.infer<typeof Model>;
export function sameModel(a: Model | undefined, b: Model) {
  return (
    a?.libraryId === b.libraryId &&
    a.assetId === b.assetId &&
    a.revisionId === b.revisionId
  );
}
