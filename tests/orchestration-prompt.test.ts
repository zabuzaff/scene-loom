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
