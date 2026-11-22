import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrationPrompt } from '../client/api';

const info = { root: '/r', cli: 'cli', guide: 'guide.md' };
const entry = (source?: object) => ({
  name: 'Desk',
  required: true,
  ...(source ? { source } : {}),
});
function setup(entries: object[] | undefined) {
  const project = {
    id: 'sb',
    title: 'T',
    contentRevision: 7,
    rehearsalInputRevision: 7,
    development: undefined,
    storyboard: undefined,
  };
  const scene = {
    id: 's1',
    title: 'S',
    description: 'd',
    notes: 'n',
    rehearsalEvents: entries
      ? [
          {
            kind: 'orchestration',
            eventId: 'e1',
            record: { stage: 'sync', inputRevision: 7, entries },
          },
        ]
      : [],
  };
  return [project, scene] as never[];
}

test('the sync card action still works while required selections are unresolved', () => {
  const [project, scene] = setup([entry()]);
  assert.ok(orchestrationPrompt(info, project, scene, 'sync'));
  assert.equal(orchestrationPrompt(info, project, scene, 'plan'), undefined);
});

test('sync is offered without a saved sync, and plan is not', () => {
  const [project, scene] = setup(undefined);
  assert.ok(orchestrationPrompt(info, project, scene, 'sync'));
  assert.equal(orchestrationPrompt(info, project, scene, 'plan'), undefined);
});

test('plan is offered once every required entry has a source', () => {
  const [project, scene] = setup([entry({ assetId: 'a' })]);
  assert.ok(orchestrationPrompt(info, project, scene, 'plan'));
  assert.equal(orchestrationPrompt(info, project, scene, 'sync'), undefined);
});

test('plan, draft and asset-generation prompts carry the spec authoring guidance', async () => {
  const [project, scene] = setup([entry({ assetId: 'a' })]);
  const plan = orchestrationPrompt(info, project, scene, 'plan') ?? '';
  assert.match(plan, /scale-reference asset/);
  assert.match(plan, /anchor\/pivot/);
  assert.match(plan, /interact and the animation clip/);
  const { assetGenerationPrompt } = await import('../client/api');
  const gen = assetGenerationPrompt(info, project as never, {
    id: 's1',
    title: 'S',
  });
  assert.match(gen, /asset\.spec/);
  assert.match(gen, /specDigest/);
});

test('a live read of the workflow outranks the recorded snapshot', () => {
  const [project, scene] = setup([entry({ assetId: 'a' })]);
  // The snapshot says plan; Foundry has since changed, so the card says sync.
  assert.ok(orchestrationPrompt(info, project, scene, 'sync', 'sync'));
  assert.equal(
    orchestrationPrompt(info, project, scene, 'plan', 'sync'),
    undefined,
  );
});

test('the draft prompt records digests in their own fields, not the note', () => {
  const [project, scene] = setup([entry({ assetId: 'a' })]);
  // Reach the publish step with a recorded plan.
  const withPlan = {
    ...(scene as object),
    rehearsalEvents: [
      ...(scene as { rehearsalEvents: object[] }).rehearsalEvents,
      { kind: 'orchestration', eventId: 'p1', record: { stage: 'plan' } },
    ],
  } as never;
  const publish = orchestrationPrompt(info, project, withPlan, 'publish') ?? '';
  assert.match(publish, /contentDigest and specDigest fields/);
  assert.doesNotMatch(publish, /in the builder note/);
});

test('review-game prompt gives the exact evidence shape and warns about rejection', () => {
  const [project, scene] = setup([entry({ assetId: 'a' })]) as unknown as [
    never,
    { rehearsalEvents: object[] },
  ];
  scene.rehearsalEvents.push({
    kind: 'orchestration',
    eventId: 'e2',
    record: { stage: 'plan', syncId: 'e1', planner: 'P', plan: {} },
  } as never);
  const prompt =
    orchestrationPrompt(
      info,
      project,
      scene as never,
      'review-game',
      'handoff',
    ) ?? '';
  for (const text of [
    '"stage":"game-review"',
    '"propCaptures":[{"piece"',
    '"scaleChecks":[{"piece"',
    '"clipChecks":[{"piece"',
    'REVIEW_EVIDENCE_REQUIRED',
  ])
    assert.ok(prompt.includes(text), text);
});

test('the repository plan prompt records the design direction in Loom and reads siblings', async () => {
  const [project] = setup(undefined);
  const { repositoryPrompt } = await import('../client/api');
  const prompt = repositoryPrompt(info, project as never, 'plan') as string;
  assert.match(prompt, /project\.design-direction\.set/);
  assert.match(prompt, /designDirection of my other Scene Loom projects/);
});
