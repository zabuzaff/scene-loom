import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
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

test('game card syncs, approves and independently reviews the exact placeholder draft', async ({
  page,
}) => {
  const { read, publish, open, clean } = await board(page, true);
  const id = read().id;
  const sceneId = 'garden';
  const source = {
    libraryId: 'fixture_foundry',
    assetId: 'gate',
    revisionId: 'prototype',
  };
  const piece = {
    id: 'gate',
    label: 'Courtyard gate',
    source,
    position: [1, 1, 2],
    size: [2, 2, 0.2],
    scale: [1, 1, 1],
    rotation: [0, 0.4, 0],
    behavior: 'Open after a selection',
  };
  const camera = 'Approach from the entrance';
  const check = 'Verify collision and selection in game';
  const digest = 'a'.repeat(64);
  const revised = 'b'.repeat(64);
  const recovered = 'c'.repeat(64);
  let accepted = true;
  let head = digest;
  let finalApproved = false;
  let approvalId: string | undefined;
  const tuple = () => ({
    storyboardId: id,
    sceneId,
    planId: 'plan',
    planRevision: 'plan',
    approvalId,
  });
  const fixture = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/agent/projects/fixture_foundry') {
      res.end(
        JSON.stringify({
          id: 'fixture_foundry',
          assets: [{ id: 'gate', name: 'Gate' }],
          accepted: accepted ? { gate: 'prototype' } : {},
          acceptance: [],
          revisions: [
            {
              id: 'prototype',
              assetId: 'gate',
              stage: 'study',
              fixture: false,
              files: [{ kind: 'model' }],
            },
          ],
        }),
      );
    } else if (req.url === '/api/library') {
      res.end(JSON.stringify({ planHeads: [{ plan: tuple(), digest: head }] }));
    } else if (req.url?.startsWith('/api/revision/')) {
      const observed = req.url.split('/').at(-1);
      res.end(
        JSON.stringify({
          digest: observed,
          parent:
            observed === 'd'.repeat(64)
              ? recovered
              : observed === recovered
                ? revised
                : observed === revised
                  ? digest
                  : null,
          scene: {
            version: 3,
            plan: tuple(),
            objects: [piece],
            pendingChecks: [check],
            scenarios: [
              {
                id: 'arrival',
                events: [
                  {
                    intent: camera,
                    route: [
                      [0, 0, 0],
                      [1, 0, 0],
                    ],
                  },
                  { intent: piece.behavior },
                ],
              },
            ],
          },
          approvals: finalApproved ? [{ kind: 'final' }] : [],
          draftReview: finalApproved
            ? { checked: 'Inspected the proxy, approach and selection cue.' }
            : undefined,
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  const listening = once(fixture, 'listening');
  fixture.listen(0, '127.0.0.1');
  await listening;
  const address = fixture.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture did not start');
  const fixtureRoot = join(root, 'foundry-fixture');
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    join(fixtureRoot, 'runtime.json'),
    JSON.stringify({
      url: `http://127.0.0.1:${address.port}`,
      token: 'fixture',
    }),
  );
  const runtime = JSON.parse(
    await readFile(join(root, 'runtime.json'), 'utf8'),
  );
  const call = (route: string, method = 'GET', body?: unknown) =>
    fetch(`${runtime.url}/api/projects/${id}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${runtime.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const record = (eventId: string, record: Record<string, unknown>) => {
    const board = read();
    return call('/apply', 'POST', {
      schemaVersion: 1,
      projectId: id,
      expectedContentRevision: board.contentRevision,
      requestId: randomUUID(),
      operations: [
        {
          type: 'rehearsal.record',
          id: sceneId,
          afterEventId:
            board.scenes[0].rehearsalEvents?.at(-1)?.eventId ?? null,
          event: { kind: 'orchestration', eventId, record },
        },
      ],
    });
  };
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  try {
    expect(
      (await call('/settings', 'PUT', { meshFoundryEnabled: true })).ok,
    ).toBe(true);
    publish({
      type: 'scene.patch',
      id: sceneId,
      changes: { selectedAssets: [{ name: 'Gate', required: true, source }] },
    });
    await open();
    const scene = page.getByRole('article', { name: 'Enter the garden' });
    const modal = page.getByRole('dialog', { name: 'Enter the garden' });
    const positions = read().positions;
    const width = () =>
      scene.evaluate((element) => (element as HTMLElement).offsetWidth);
    await expect.poll(width).toBe(300);
    await scene.getByRole('button', { name: 'Open Enter the garden' }).click();
    await expect(
      modal.getByRole('heading', { name: 'Where you left off' }),
    ).toBeVisible();
    await modal
      .getByRole('button', { name: 'Copy accepted-asset sync prompt' })
      .click();
    expect(await clipboard()).toContain(`scene accepted-assets ${id} garden`);
    const preview = (
      await (await call('/scenes/garden/accepted-assets')).json()
    ).data;
    expect(preview.entries).toEqual([{ name: 'Gate', required: true, source }]);
    expect((await record('sync', { stage: 'sync', ...preview })).ok).toBe(true);
    await expect(
      modal.getByText('1 of 1 required assets verified'),
    ).toBeVisible();
    await expect(
      modal.getByRole('heading', { name: 'Accepted-model manifest' }),
    ).toBeVisible();
    await modal
      .getByRole('button', { name: 'Copy scene orchestrator planner prompt' })
      .click();
    const planner = await clipboard();
    for (const value of [
      id,
      sceneId,
      'Walk through the courtyard and try the gate.',
      source.revisionId,
      source.libraryId,
    ])
      expect(planner).toContain(value);
    const draftRecord = (revisionId: string, parent: string | null) => ({
      stage: 'publication',
      approvalId: approvalId ?? 'unapproved',
      builder: 'builder',
      dataDir: '/private/tmp/garden-draft-fixture',
      port: address.port,
      revisionId,
      parent,
      scenarioId: 'arrival',
    });
    expect((await record('premature', draftRecord(digest, null))).status).toBe(
      409,
    );
    const proposal = {
      stage: 'plan',
      syncId: 'sync',
      planner: 'planner',
      plan: {
        intent: 'Find the courtyard gate',
        pieces: [piece],
        cameraOrTraversal: [camera],
        checks: [check],
        references: [],
      },
    };
    expect((await record('initial-plan', proposal)).ok).toBe(true);
    await modal.getByText('Courtyard gate', { exact: true }).click();
    await expect(
      modal.getByText('Open after a selection', { exact: true }),
    ).toBeVisible();
    await expect(
      modal.getByRole('button', { name: 'Copy rehearsal draft prompt' }),
    ).toHaveCount(0);
    expect(
      (
        await record('fake-approval', {
          stage: 'decision',
          planId: 'plan',
          verdict: 'approved',
        })
      ).status,
    ).toBe(403);
    await modal
      .getByLabel('Changes to request')
      .fill('Keep the gate visible from the courtyard.');
    await modal
      .getByRole('button', { name: 'Request changes', exact: true })
      .click();
    await modal
      .getByRole('button', { name: 'Copy scene orchestrator planner prompt' })
      .click();
    expect(await clipboard()).toContain(
      'Keep the gate visible from the courtyard.',
    );
    expect(
      (
        await record('plan', {
          ...proposal,
          plan: {
            ...proposal.plan,
            intent: 'Keep the gate visible from the courtyard.',
          },
        })
      ).ok,
    ).toBe(true);
    await modal
      .getByRole('button', { name: 'Approve plan', exact: true })
      .click();
    await modal
      .getByRole('button', { name: 'Copy rehearsal draft prompt' })
      .click();
    approvalId = read().scenes[0].rehearsalEvents?.at(-1)?.eventId;
    expect(await clipboard()).toContain(approvalId);
    expect((await record('draft', draftRecord(digest, null))).ok).toBe(true);
    await modal
      .getByRole('button', { name: 'Copy rehearsal draft review prompt' })
      .click();
    expect(await clipboard()).toContain(digest);
    const review = (
      publicationId: string,
      verdict: string,
      reviewer = 'independent',
    ) =>
      record(randomUUID(), {
        stage: 'draft-review',
        publicationId,
        reviewer,
        verdict,
        findings: [
          verdict === 'approved'
            ? 'Inspected the proxy, approach and selection cue.'
            : 'Camera cue starts too late.',
        ],
      });
    expect((await review('draft', 'changes-requested', 'builder')).status).toBe(
      409,
    );
    head = revised;
    expect((await review('draft', 'changes-requested')).status).toBe(409);
    head = digest;
    expect((await review('draft', 'changes-requested')).ok).toBe(true);
    await expect(modal.getByText('Draft changes requested')).toBeVisible();
    await expect(
      modal.getByRole('button', { name: 'Copy rehearsal draft prompt' }),
    ).toBeVisible();
    head = revised;
    expect((await record('draft-2', draftRecord(revised, digest))).ok).toBe(
      true,
    );
    expect((await review('draft', 'approved')).status).toBe(409);
    expect((await review('draft-2', 'approved')).status).toBe(409);
    finalApproved = true;
    accepted = false;
    expect(
      (await (await review('draft-2', 'approved')).json()).error.code,
    ).toBe('STALE_FOUNDRY');
    accepted = true;
    expect((await review('draft-2', 'approved')).ok).toBe(true);
    await modal
      .getByRole('button', { name: 'Copy game implementation handoff' })
      .click();
    expect(await clipboard()).toContain(revised);
    expect(await clipboard()).toContain(check);
    await page.screenshot({ path: 'test-results/progress-game-expanded.png' });
    await page.setViewportSize({ width: 390, height: 650 });
    await expect(
      modal.getByRole('heading', { name: 'Accepted-model manifest' }),
    ).toBeVisible();
    expect((await modal.boundingBox())!.width).toBeLessThan(390);
    await page.screenshot({ path: 'test-results/rehearsal-action-narrow.png' });
    await page.setViewportSize({ width: 1440, height: 960 });
    const latest = 'd'.repeat(64);
    head = latest;
    expect(
      (await record('reconciled', draftRecord(latest, recovered))).ok,
    ).toBe(true);
    expect((await review('reconciled', 'plan-changes-requested')).ok).toBe(
      true,
    );
    await modal
      .getByRole('button', { name: 'Copy scene orchestrator planner prompt' })
      .click();
    expect(await clipboard()).toContain('plan-changes-requested');
    await expect(
      modal.getByRole('button', { name: 'Copy rehearsal draft prompt' }),
    ).toHaveCount(0);
    publish({
      type: 'scene.patch',
      id: sceneId,
      changes: { description: 'Changed traversal intent.' },
    });
    await expect(
      modal.getByRole('button', { name: 'Copy accepted-asset sync prompt' }),
    ).toBeVisible();
    expect(
      (await record('stale-draft', draftRecord(revised, digest))).status,
    ).toBe(409);
    await expect(
      modal.getByRole('heading', { name: 'Earlier accepted-model manifest' }),
    ).toBeVisible();
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
    fixture.close();
    await clean();
  }
});
