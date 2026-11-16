import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
const note = z.string().trim().min(1).max(8000);
const revision = z.number().int().nonnegative();
const status = z.enum([
  'planned',
  'in-development',
  'needs-verification',
  'blocked',
  'verified',
]);
export const Slice = z.strictObject({
  id,
  name: z.string().trim().min(1).max(200),
  sceneIds: z.array(id).min(1).max(500),
  dependencies: z.array(id).max(500),
});
const repository = note.refine(
  (path) => path.startsWith('/') && !/[\p{Cc}]/u.test(path),
  'Use the canonical absolute Git common directory.',
);
export const Plan = z.strictObject({
  repository: repository.optional(),
  files: z
    .array(
      z.strictObject({
        path: note.refine(
          (path) =>
            !/[\p{Cc}\\:]/u.test(path) &&
            path
              .split('/')
              .every((part) => part && part !== '.' && part !== '..'),
          'Use a repository-relative path without parent traversal.',
        ),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(30),
  slices: z.array(Slice).max(500),
});
const checkpoint = z.strictObject({
  status: status.exclude(['planned']),
  changed: note,
  remaining: note,
  resume: note,
  blocker: note.optional(),
  evidence: z.array(note).max(100),
});
const review = z.strictObject({
  verdict: z.enum(['ready', 'needs-revision']),
  evidence: note,
});
export const Development = z.strictObject({
  plan: Plan,
  planRevision: revision,
  review: review.optional(),
  priorPlans: z
    .array(
      z.strictObject({
        plan: Plan,
        planRevision: revision,
        review: review.optional(),
      }),
    )
    .optional(),
  records: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('start'),
        sliceId: id,
        planRevision: revision,
        claimId: id,
      }),
      z.strictObject({
        kind: z.literal('checkpoint'),
        sliceId: id,
        planRevision: revision,
        claimId: id,
        checkpoint,
      }),
    ]),
  ),
});
export const developmentOperations = [
  z.strictObject({
    type: z.literal('development.plan.set'),
    plan: Plan.extend({ repository }),
  }),
  z.strictObject({
    type: z.literal('development.plan.review'),
    planRevision: revision,
    review,
  }),
  z.strictObject({
    type: z.literal('development.start'),
    planRevision: revision,
    sliceId: id,
    sceneId: id,
    claimId: id,
    afterClaimId: id.nullable(),
    replacesClaimId: id.optional(),
  }),
  z.strictObject({
    type: z.literal('development.checkpoint'),
    planRevision: revision,
    sliceId: id,
    claimId: id,
    checkpoint,
  }),
] as const;

export type Development = z.infer<typeof Development>;
export type Plan = z.infer<typeof Plan>;
export type Slice = z.infer<typeof Slice>;

export function planError(plan: Plan, sceneIds: Set<string>) {
  const slices = new Map(plan.slices.map((slice) => [slice.id, slice]));
  if (
    slices.size !== plan.slices.length ||
    new Set(plan.files.map(({ path }) => path)).size !== plan.files.length
  )
    return 'Plan files and slice IDs must be unique.';
  const done = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): boolean {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    const slice = slices.get(id);
    if (!slice) return false;
    visiting.add(id);
    if (!slice.dependencies.every(visit)) return false;
    visiting.delete(id);
    done.add(id);
    return true;
  }
  for (const slice of slices.values()) {
    if (
      new Set(slice.sceneIds).size !== slice.sceneIds.length ||
      slice.sceneIds.some((id) => !sceneIds.has(id)) ||
      new Set(slice.dependencies).size !== slice.dependencies.length
    )
      return 'Link each slice to distinct existing scenes and prerequisites.';
    if (!visit(slice.id))
      return 'Slice prerequisites must exist and cannot form a cycle.';
  }
}

export function sliceProgress(development: Development, id: string) {
  const records = development.records.filter((record) => record.sliceId === id);
  records.reverse();
  const current = records.find(
    ({ planRevision }) => planRevision === development.planRevision,
  );
  const latest = records.find((record) => record.kind === 'checkpoint');
  return {
    status:
      current?.kind === 'start'
        ? 'in-development'
        : (current?.checkpoint.status ?? 'planned'),
    afterClaimId: current?.claimId ?? null,
    claimId: current?.kind === 'start' ? current.claimId : undefined,
    latest,
  } as const;
}

export function sceneDevelopment(
  development: Development | undefined,
  sceneId: string,
  sliceId?: string,
) {
  if (!development) return;
  const slices = development.plan.slices
    .filter((slice) => slice.sceneIds.includes(sceneId))
    .map((slice) => ({
      ...slice,
      ...sliceProgress(development, slice.id),
      prerequisite: slice.dependencies
        .map((id) => development.plan.slices.find((s) => s.id === id)!)
        .find((s) => sliceProgress(development, s.id).status !== 'verified'),
    }));
  const unfinished = slices.filter(({ status }) => status !== 'verified');
  const ready = unfinished.filter(({ prerequisite }) => !prerequisite);
  const next =
    (sliceId ? slices.find(({ id }) => id === sliceId) : undefined) ??
    ready.find(({ claimId }) => claimId) ??
    ready.find(({ status }) => status !== 'planned') ??
    ready[0] ??
    unfinished[0] ??
    slices[0];
  if (next)
    return {
      latest: development.records
        .filter((record) => record.kind === 'checkpoint')
        .reverse()
        .find((record) => slices.some(({ id }) => id === record.sliceId)),
      slices,
      next,
      reviewed:
        !!development.plan.repository &&
        development.review?.verdict === 'ready',
      planRevision: development.planRevision,
    };
}

export const developmentLabels = {
  planned: 'Planned',
  'in-development': 'In development',
  'needs-verification': 'Needs verification',
  blocked: 'Blocked',
  verified: 'Verified',
} as const;

export function developmentTargetKey(
  target: NonNullable<ReturnType<typeof sceneDevelopment>>,
) {
  const { planRevision, next } = target;
  return `${planRevision}:${next.id}:${next.status}:${next.afterClaimId ?? ''}`;
}
