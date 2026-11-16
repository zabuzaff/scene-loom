import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { visionFixture } from '../vision-fixture';
import type { ProjectData } from '../../shared/schema';

const root = '/private/tmp/scene-loom-browser-tests';
const cli = (args: string[], input?: unknown) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'cli/index.ts',
        ...args,
        ...(input === undefined ? [] : ['-']),
      ],
      {
        encoding: 'utf8',
        input: input === undefined ? undefined : JSON.stringify(input),
        env: { ...process.env, SCENE_LOOM_DATA_DIR: root },
      },
    ),
  ).data;

async function board(page: Page, game = false) {
  const id = `progress_${randomUUID()}`;
  const title = game ? 'Tide Garden' : 'Booking Studio';
  cli(['project', 'create'], { id, title });
  const read = (): ProjectData => cli(['project', 'read', id]);
  const publish = (...operations: unknown[]) =>
    cli(['project', 'apply', id], {
      schemaVersion: 1,
      projectId: id,
      expectedContentRevision: read().contentRevision,
      requestId: `op_${randomUUID()}`,
      operations,
    });
  const scenes = game
    ? [['garden', 'Enter the garden']]
    : [
        ['search', 'Search appointments'],
        ['list', 'Choose a time'],
        ['confirm', 'Confirm appointment'],
      ];
  publish(
    {
      type: 'project.vision.set',
      vision: {
        ...visionFixture,
        name: title,
        projectType: game ? '3D exploration game' : 'Web app',
      },
    },
    ...scenes.map(([id, title]) => ({
      type: 'scene.create',
      scene: {
        id,
        title,
        description: game
          ? 'Walk through the courtyard and try the gate.'
          : 'Find a convenient time in the schedule.',
        notes: game
          ? 'Keep the gate visible from the entrance. '.repeat(50)
          : '',
        supportingAssetIds: [],
      },
    })),
  );
  const open = async () => {
    await page.goto('/');
    const trigger = page.locator('.project-trigger');
    await expect(trigger).toBeVisible();
    if (!(await trigger.innerText()).includes(title)) {
      await trigger.click();
      await page
        .getByRole('button', { name: `${title} ${scenes.length} scenes` })
        .click();
    }
  };
  const clean = () =>
    rm(join(root, 'projects', id), { recursive: true, force: true });
  return { id, title, read, publish, open, clean };
}

test('ordinary cards select the reviewed slice and resume a shared checkpoint after reload', async ({
  page,
}) => {
  const { id, read, publish, open, clean } = await board(page);
  const files = [{ path: 'docs/booking-plan.md', sha256: 'a'.repeat(64) }];
  const slices = [
    {
      id: 'booking-search',
      name: 'Search and choose',
      sceneIds: ['search', 'list'],
      dependencies: [],
    },
    {
      id: 'confirmation',
      name: 'Confirmation',
      sceneIds: ['confirm'],
      dependencies: ['booking-search'],
    },
    {
      id: 'filters',
      name: 'Saved filters',
      sceneIds: ['search'],
      dependencies: [],
    },
  ];
  const plan = {
    type: 'development.plan.set',
    plan: { repository: '/fixture/.git', files, slices },
  };
  try {
    publish(plan);
    await open();
    const search = page.getByRole('article', { name: 'Search appointments' });
    const list = page.getByRole('article', { name: 'Choose a time' });
    const confirm = page.getByRole('article', { name: 'Confirm appointment' });
    await expect(search).toContainText('Plan needs review');
    const planRevision = read().development!.planRevision;
    publish({
      type: 'development.plan.review',
      planRevision,
      review: {
        verdict: 'ready',
        evidence: 'Reviewed checkout and exact plan files.',
      },
    });
    const start = search.getByRole('button', {
      name: 'Copy start development prompt',
    });
    await start.click();
    const copied = () => page.evaluate(() => navigator.clipboard.readText());
    for (const value of [
      `scene read ${id} search`,
      'booking-search',
      files[0].sha256,
      'development.start',
    ])
      expect(await copied()).toContain(value);
    await expect(confirm).toContainText('Waiting for Search and choose');
    await expect(
      confirm.getByRole('button', { name: 'Open Search appointments' }),
    ).toBeVisible();
    await expect(search.locator('progress')).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/progress-ordinary-compact.png',
    });
    publish({
      type: 'development.start',
      planRevision,
      sceneId: 'search',
      sliceId: 'booking-search',
      afterClaimId: null,
      claimId: 'run',
    });
    await expect(search).toContainText('In development');
    await expect(list).toContainText('In development');
    publish({
      type: 'development.checkpoint',
      planRevision,
      sliceId: 'booking-search',
      claimId: 'run',
      checkpoint: {
        status: 'needs-verification',
        changed: 'Saved search selection.',
        remaining: 'Check selection after login.',
        resume: 'Open /appointments after signing in.',
        evidence: ['Search component test passed.'],
      },
    });
    await page.reload();
    await expect(list).toContainText('Needs verification');
    await list
      .getByRole('button', { name: 'Copy continue development prompt' })
      .click();
    expect(await copied()).toContain('Open /appointments after signing in.');
    publish({
      type: 'development.start',
      planRevision,
      sceneId: 'search',
      sliceId: 'filters',
      afterClaimId: null,
      claimId: 'filters-run',
    });
    await expect(search).toContainText('In development · Saved filters');
    await confirm
      .getByRole('button', { name: 'Open Search appointments' })
      .click();
    await expect(
      search.getByRole('heading', { name: 'Development slices' }),
    ).toBeVisible();
    await search
      .getByRole('button', { name: 'Copy continue development prompt' })
      .click();
    expect(await copied()).toContain('sliceId booking-search');
    publish({
      type: 'development.start',
      planRevision,
      sceneId: 'search',
      sliceId: 'booking-search',
      afterClaimId: 'run',
      claimId: 'resume-run',
    });
    for (const [sliceId, claimId] of [
      ['filters', 'filters-run'],
      ['booking-search', 'resume-run'],
    ]) {
      publish({
        type: 'development.checkpoint',
        planRevision,
        sliceId,
        claimId,
        checkpoint: {
          status: 'in-development',
          changed: 'Paused for plan revision.',
          remaining: 'Resume under the reviewed replacement.',
          resume: 'Read the new plan mapping.',
          evidence:
            sliceId === 'booking-search'
              ? ['Search component test passed.']
              : [],
        },
      });
    }
    publish({
      ...plan,
      plan: {
        ...plan.plan,
        slices,
        files: [{ ...files[0], sha256: 'b'.repeat(64) }],
      },
    });
    await expect(search).toContainText('Plan needs review');
    await expect(
      search.getByRole('button', { name: 'Copy continue development prompt' }),
    ).toHaveCount(0);
    await search
      .getByText('Search and choose · Planned', { exact: true })
      .click();
    await expect(search).toContainText('Earlier plan evidence');
    await expect(search).toContainText('Search component test passed.');
  } finally {
    await clean();
  }
});

test('expanded game card routes Foundry acceptance and rehearsal corrections from saved evidence', async ({
  page,
}) => {
  const { read, publish, open, clean } = await board(page, true);
  try {
    await open();
    await page.locator('.project-trigger').click();
    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('switch', { name: 'Mesh Foundry handoff' }).click();
    await page.keyboard.press('Escape');
    const sceneId = 'garden';
    const record = (event: Record<string, unknown>) =>
      publish({
        type: 'rehearsal.record',
        id: sceneId,
        afterEventId: read().scenes[0].rehearsalEvents?.at(-1)?.eventId ?? null,
        event,
      });
    const model = (assetId: string, revisionId: string) => ({
      libraryId: 'fixture_foundry',
      assetId,
      revisionId,
    });
    const link = (revisionId: string) =>
      `http://127.0.0.1:4332/?revision=${revisionId}`;
    const draft = (revisionId: string) => ({
      dataDir: '/private/tmp/tide-garden-rehearsal',
      port: 4332,
      revisionId,
      link: link(revisionId),
    });
    publish({
      type: 'scene.patch',
      id: sceneId,
      changes: {
        rehearsalBrief: {
          layout:
            'A small garden courtyard with a gate and optional wind chimes.',
          scenarios: [
            'Walk through the arch and trigger the opening animation.',
          ],
          assets: [
            {
              name: 'Gate',
              decision: 'use',
              rationale: 'Controls the entrance',
              behavior: 'Opens on approach',
            },
            {
              name: 'Path lantern',
              decision: 'missing',
              rationale: 'Lights the required route',
              behavior: 'Steady light',
            },
            {
              name: 'Wind chimes',
              decision: 'optional',
              rationale: 'Ambience',
              behavior: 'Idle',
            },
          ],
          gaps: [],
        },
      },
    });
    record({
      kind: 'review',
      eventId: 'review',
      inputRevision: read().rehearsalInputRevision,
      blockout: 'ready',
      imports: 'ready',
      scope: 'Garden entry',
      findings: ['Gate clearance is the primary check.'],
    });
    const requirement = {
      id: 'gate_fit',
      name: 'Gate',
      source: model('gate', 'source'),
      sourceLink: 'http://127.0.0.1:4331/?revision=source',
      objects: ['gate_proxy'],
      measurements: [{ label: 'Width', value: 2, unit: 'm' }],
      changes: ['Align hinge.'],
      preserve: ['Keep the latch.'],
      checks: ['Check clearance.'],
    };
    record({
      kind: 'draft',
      eventId: 'first_draft',
      reviewId: 'review',
      parentRevisionId: null,
      draft: draft('garden_v1'),
      requirements: [
        requirement,
        {
          ...requirement,
          id: 'chimes_fit',
          name: 'Wind chimes',
          source: model('chimes', 'source'),
          objects: ['chime_proxy'],
        },
      ],
    });
    publish({
      type: 'development.plan.set',
      plan: {
        repository: '/fixture/.git',
        files: [{ path: 'docs/garden-plan.md', sha256: 'c'.repeat(64) }],
        slices: [
          {
            id: 'gate_trigger',
            name: 'Gate trigger',
            sceneIds: [sceneId],
            dependencies: [],
          },
        ],
      },
    });
    const planRevision = read().development!.planRevision;
    publish({
      type: 'development.plan.review',
      planRevision,
      review: {
        verdict: 'ready',
        evidence: 'Verified the gate trigger acceptance checks.',
      },
    });
    const scene = page.locator('article[aria-label="Enter the garden"]');
    const modal = page.getByRole('dialog', { name: 'Enter the garden' });
    await expect(scene).toContainText('2 required asset fit checks open');
    const width = () =>
      scene.evaluate((element) => (element as HTMLElement).offsetWidth);
    expect(await width()).toBe(300);
    await page.screenshot({ path: 'test-results/progress-game-compact.png' });
    const positions = read().positions;
    await scene.getByRole('button', { name: 'Open Enter the garden' }).click();
    await expect(
      modal.getByRole('heading', { name: 'Where you left off' }),
    ).toBeVisible();
    expect(await width()).toBe(300);
    await expect
      .poll(async () => (await modal.boundingBox())?.width ?? 0)
      .toBeGreaterThan(700);
    expect(read().positions).toEqual(positions);
    await expect(modal).toContainText(
      '0 of 2 required assets fit the current rehearsal',
    );
    await expect(modal).toContainText('0 of 1 slices verified');
    await expect(
      modal.getByRole('button', {
        name: 'Copy Foundry revision request for Gate',
      }),
    ).toBeVisible();
    const candidate = model('gate', 'candidate');
    const modelLink = 'http://127.0.0.1:4331/?revision=candidate';
    record({
      kind: 'candidate',
      eventId: 'new_model',
      requirementId: 'gate_fit',
      model: candidate,
      basedOn: requirement.source,
      modelLink,
    });
    await expect(modal).toContainText('Copy developed model review prompt');
    await expect(
      modal.getByRole('link', { name: 'Open Mesh Foundry revision candidate' }),
    ).toHaveAttribute('href', modelLink);
    record({
      kind: 'candidate',
      eventId: 'cleared',
      requirementId: 'gate_fit',
      model: candidate,
      basedOn: candidate,
      clearedReview: {
        ownerAcceptance: 'pending',
        evidence: ['Model meets dimensions; awaiting owner.'],
      },
    });
    await expect(modal).toContainText('Acceptance → Accept this revision');
    await expect(
      modal.getByRole('button', {
        name: 'Copy Foundry acceptance verification prompt for Gate',
      }),
    ).toBeVisible();
    record({
      kind: 'candidate-review',
      eventId: 'accepted',
      requirementId: 'gate_fit',
      model: candidate,
      verdict: 'accepted',
      evidence: ['Owner acceptance verified.'],
    });
    await modal
      .getByRole('button', { name: 'Copy rehearsal fit-check prompt for Gate' })
      .click();
    const copied = () => page.evaluate(() => navigator.clipboard.readText());
    await expect(modal.getByRole('status')).toContainText('prompt copied');
    expect(await copied()).toContain('garden_v1');
    expect(await copied()).toContain(JSON.stringify(candidate));
    const fit = (
      eventId: string,
      verdict: string,
      rehearsalRevisionId = 'garden_v1',
      extra = {},
    ) =>
      record({
        kind: 'fit',
        eventId,
        requirementId: 'gate_fit',
        model: candidate,
        rehearsalRevisionId,
        verdict,
        evidence: ['Gate swings into the camera path.'],
        ...extra,
      });
    fit('placement', 'rehearsal-issue');
    await modal.locator('.scene-production-body').evaluate((el) => {
      el.scrollTop = 0;
    });
    const nextAction = modal.getByRole('button', {
      name: 'Copy rehearsal correction request · Gate',
    });
    await expect(nextAction).toBeInViewport();
    await nextAction.click();
    expect(await copied()).toContain('placement');
    await modal.locator('.scene-production-body').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: 'test-results/progress-game-expanded.png' });
    fit('missing_rule', 'rehearsal-issue', 'garden_v1', {
      capabilityBlocker:
        'Rehearsal cannot trigger a clip from this proximity event.',
    });
    await expect(modal).toContainText('Scene Rehearsal capability blocker');
    await expect(
      modal.getByRole('button', {
        name: 'Copy rehearsal correction request for Gate',
      }),
    ).toHaveCount(0);
    fit('passed', 'pass', 'garden_v1', {
      evidence: ['Verified gate clearance and playback in the current draft.'],
    });
    await expect(modal).toContainText(
      '1 of 2 required assets fit the current rehearsal',
    );
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(scene).toContainText('1 required asset fit check open');
    await scene.getByRole('button', { name: 'Open Enter the garden' }).click();
    record({
      kind: 'draft',
      eventId: 'next_draft',
      reviewId: 'review',
      parentRevisionId: 'garden_v1',
      draft: draft('garden_v2'),
      requirements: [],
    });
    await expect(modal).toContainText(
      '0 of 2 required assets fit the current rehearsal',
    );
    expect(() => fit('stale', 'pass')).toThrow();
    const details = modal.locator('.scene-production-body');
    await details.evaluate((el) => {
      el.scrollTop = 0;
    });
    await details.hover();
    const viewport = page.locator('.react-flow__viewport');
    const transform = await viewport.getAttribute('style');
    await page.mouse.wheel(0, 450);
    await expect
      .poll(() => details.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    expect(await viewport.getAttribute('style')).toBe(transform);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect.poll(width).toBe(300);
    const heading = await scene
      .getByRole('heading', { name: 'Enter the garden' })
      .boundingBox();
    await page.mouse.move(heading!.x + 20, heading!.y + 10);
    await page.mouse.down();
    await page.mouse.move(heading!.x + 110, heading!.y + 42, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => read().positions).not.toEqual(positions);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(transform);
  } finally {
    await clean();
  }
});
