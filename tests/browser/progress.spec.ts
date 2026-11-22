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

test('game card syncs, plans, links one draft and starts implementation', async ({
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
  const accepted = true;
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
      res.end(
        JSON.stringify({ drafts: [{ key: `${id}/${sceneId}`, digest }] }),
      );
    } else if (req.url?.startsWith('/api/revision/')) {
      res.end(
        JSON.stringify({
          digest: req.url.split('/').at(-1),
          scene: {
            version: 3,
            plan: { storyboardId: id, sceneId },
            scenarios: [{ id: 'arrival' }],
          },
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
  const rehearsalRoot = join(root, 'rehearsal-fixture');
  await mkdir(rehearsalRoot, { recursive: true });
  await writeFile(
    join(rehearsalRoot, 'runtime.json'),
    JSON.stringify({ url: `http://127.0.0.1:${address.port}`, pid: 1 }),
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
  // Card actions are checked against fresh state before copying, so wait for
  // the clipboard to change rather than reading it at once.
  let seen = '';
  const clipboard = async () => {
    const read = () => page.evaluate(() => navigator.clipboard.readText());
    await expect.poll(read).not.toBe(seen);
    seen = await read();
    return seen;
  };
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
    // A layout-only refresh must not re-fire the live Foundry read.
    let reads = 0;
    page.on('request', (request) => {
      if (request.url().includes('/workflow')) reads++;
    });
    await page.waitForTimeout(500);
    const before = reads;
    const board = read();
    expect(
      (
        await call('/layout', 'PATCH', {
          expectedLayoutRevision: board.layoutRevision,
          positions: { garden: { x: 420, y: 260 } },
        })
      ).ok,
    ).toBe(true);
    await expect
      .poll(() => read().positions.garden)
      .toEqual({ x: 420, y: 260 });
    await page.waitForTimeout(1500);
    expect(reads).toBe(before);
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
    const draftRecord = {
      stage: 'draft',
      builder: 'builder',
      url: `http://127.0.0.1:${address.port}`,
      draftId: digest,
      scenarioId: 'arrival',
    };
    expect((await record('premature', draftRecord)).status).toBe(409);
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
    expect((await record('plan', proposal)).ok).toBe(true);
    await modal.getByText('Courtyard gate', { exact: true }).click();
    await expect(
      modal.getByText('Open after a selection', { exact: true }),
    ).toBeVisible();
    await expect(
      modal.getByRole('button', { name: 'Approve plan', exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await record('retired', {
          stage: 'decision',
          planId: 'plan',
          verdict: 'approved',
        })
      ).status,
    ).toBe(403);
    await modal
      .getByRole('button', { name: 'Copy rehearsal draft prompt' })
      .click();
    const builder = await clipboard();
    expect(builder).toContain(`storyboardId ${id}`);
    expect(builder).toContain(`sceneId ${sceneId}`);
    expect(builder).toContain('overwrites the same draft');
    expect(builder).not.toContain('SCENE_REHEARSAL');
    expect((await record('draft', draftRecord)).ok).toBe(true);
    await expect(modal.getByRole('link', { name: /Open draft/ })).toBeVisible();
    await expect(
      modal.getByRole('button', { name: 'Copy rehearsal draft prompt' }),
    ).toHaveCount(0);
    // A passing in-game review must carry evidence in every category.
    const gameRecord = {
      stage: 'game-review',
      draftId: digest,
      reviewer: 'reviewer',
      build: 'build-42',
      route: '/garden',
      verdict: 'ready',
      findings: ['SS1 Gate scale matches the baseline.'],
    };
    const rejected = await record('game-review-bare', gameRecord);
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).error.code).toBe('REVIEW_EVIDENCE_REQUIRED');
    expect(
      (
        await record('game-review', {
          ...gameRecord,
          evidence: {
            propCaptures: [
              { piece: 'gate', captureRef: 'captures/gate-free-cam.png' },
              { piece: 'gate', captureRef: 'captures/gate-side.png' },
            ],
            scaleChecks: [
              { piece: 'gate', against: 'Hero 1.8 m', result: '2.0 m tall' },
            ],
            clipChecks: [
              {
                piece: 'gate',
                clip: 'open',
                action: 'Select the gate',
                result: 'Matches; idle is still',
              },
            ],
          },
        })
      ).ok,
    ).toBe(true);
    const summary = modal.locator('.game-review-summary');
    await expect(summary).toContainText('In-game review: Ready');
    await expect(summary).toContainText(
      '2 prop captures · 1 scale check · 1 clip check',
    );
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/game-review-evidence.png' });
    await modal
      .getByRole('button', { name: 'Copy start implementation prompt' })
      .click();
    const start = await clipboard();
    expect(start).toContain(digest);
    expect(start).toContain(check);
    expect(start).toContain('final approval');
    await modal
      .getByRole('button', { name: 'Copy scene status resync prompt' })
      .click();
    const statusPrompt = await clipboard();
    expect(statusPrompt).toContain(`scene read ${id} ${sceneId}`);
    expect(statusPrompt).toContain('scene.status.record');
    expect(statusPrompt).toContain(
      'Inspect Foundry, Rehearsal and the target implementation read-only',
    );
    const inputRevision = read().rehearsalInputRevision;
    publish({
      type: 'scene.status.record',
      id: sceneId,
      report: {
        foundry: 'Gate prototype verified in the linked library.',
        rehearsal: `Accepted draft ${digest}.`,
        implementation: 'Gate selection verified on /garden.',
        next: 'Review the arrival view.',
      },
    });
    expect(read().rehearsalInputRevision).toBe(inputRevision);
    await modal.getByText('Last resync', { exact: false }).click();
    await expect(
      modal.getByText('Gate selection verified on /garden.'),
    ).toBeVisible();
    await expect(modal.getByText('Storyboard inputs changed')).toHaveCount(0);
    await modal
      .getByRole('button', { name: 'Copy in-game scene review prompt' })
      .click();
    const gameReview = await clipboard();
    expect(gameReview).toContain(digest);
    expect(gameReview).toContain('SS1, SS2');
    expect(gameReview).toContain('still match the active handoff');
    expect(gameReview).toContain(
      'stop and ask for a fresh in-game scene review prompt',
    );
    expect(gameReview).toContain(
      'In both the report and the paste-ready correction prompt, record the exact running build ID and reviewed route.',
    );
    expect(gameReview).toContain('orbit, pan, zoom, or focus on selection');
    expect(gameReview).toContain('Report any inspection limits.');
    expect(gameReview).toContain('Capture every prop with a free camera');
    expect(gameReview).toContain('flag anything moving while idle or gliding');
    expect(gameReview).toContain(
      'If the field is blank or the reference cannot be resolved, continue the review and flag scale judgments that need a reference.',
    );
    expect(gameReview).toContain(
      'Record the measured size separately from any owner-approved baseline.',
    );
    expect(gameReview).toContain(
      'Mark behavior that cannot be exercised as pending',
    );
    expect(gameReview).toContain('approved, proposed, or unverified');
    expect(gameReview).toContain('original capture');
    expect(gameReview).toContain('paste-ready correction prompt');
    expect(gameReview.trimEnd()).toMatch(
      /3D prototype name for scale reference:$/,
    );
    expect(gameReview).not.toContain('Record one rehearsal.record event');
    expect(gameReview).toContain('REVIEW_EVIDENCE_REQUIRED');
    expect(gameReview).toContain('"stage":"game-review"');
    await page.screenshot({ path: 'test-results/progress-game-expanded.png' });
    await page.setViewportSize({ width: 390, height: 650 });
    await expect(
      modal.getByRole('heading', { name: 'Accepted-model manifest' }),
    ).toBeVisible();
    expect((await modal.boundingBox())!.width).toBeLessThan(390);
    await page.screenshot({ path: 'test-results/rehearsal-action-narrow.png' });
    await page.setViewportSize({ width: 1440, height: 960 });
    publish({
      type: 'scene.patch',
      id: sceneId,
      changes: { description: 'Changed traversal intent.' },
    });
    await expect(
      modal.getByRole('button', { name: 'Copy accepted-asset sync prompt' }),
    ).toBeVisible();
    expect((await record('stale-draft', draftRecord)).status).toBe(409);
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
    const beforeDrag = read().positions;
    await page.mouse.move(heading!.x + 20, heading!.y + 10);
    await page.mouse.down();
    await page.mouse.move(heading!.x + 110, heading!.y + 42, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => read().positions).not.toEqual(beforeDrag);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(transform);
  } finally {
    fixture.close();
    await clean();
  }
});

// A minimal Foundry that knows one asset ("Gate") and has accepted nothing.
async function unacceptedFoundry() {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/agent/projects/fixture_foundry')
      res.end(
        JSON.stringify({
          id: 'fixture_foundry',
          assets: [{ id: 'gate', name: 'Gate' }],
          accepted: {},
          acceptance: [],
          revisions: [],
        }),
      );
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
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
  return {
    stop: () => {
      server.closeAllConnections();
      return new Promise<void>((done) => server.close(() => done()));
    },
  };
}

// Enables handoff, selects the required Gate and saves the live preview as
// the scene's sync record, the way an agent would.
async function selectAndSyncGate(id: string, sceneId: string) {
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
  const json = async (response: Response) => (await response.json()).data;
  expect(
    (await call('/settings', 'PUT', { meshFoundryEnabled: true })).ok,
  ).toBe(true);
  const project = await json(await call(''));
  const patch = await call('/apply', 'POST', {
    schemaVersion: 1,
    projectId: id,
    expectedContentRevision: project.contentRevision,
    requestId: randomUUID(),
    operations: [
      {
        type: 'scene.patch',
        id: sceneId,
        changes: {
          selectedAssets: [
            {
              name: 'Gate',
              required: true,
              source: {
                libraryId: 'fixture_foundry',
                assetId: 'gate',
                revisionId: 'prototype',
              },
            },
          ],
        },
      },
    ],
  });
  expect(patch.ok).toBe(true);
  const preview = await json(await call(`/scenes/${sceneId}/accepted-assets`));
  const current = await json(await call(''));
  const sync = await call('/apply', 'POST', {
    schemaVersion: 1,
    projectId: id,
    expectedContentRevision: current.contentRevision,
    requestId: randomUUID(),
    operations: [
      {
        type: 'rehearsal.record',
        id: sceneId,
        afterEventId: null,
        event: {
          kind: 'orchestration',
          eventId: 'sync',
          record: { stage: 'sync', ...preview },
        },
      },
    ],
  });
  expect(sync.ok).toBe(true);
  return preview;
}

test('the owner resolves a required selection from the card through the real browser session', async ({
  page,
}) => {
  const { id, open, clean } = await board(page, true);
  const foundry = await unacceptedFoundry();
  try {
    const preview = await selectAndSyncGate(id, 'garden');
    expect(preview.entries[0]).toMatchObject({ name: 'Gate', required: true });
    expect(preview.entries[0].source).toBeUndefined();
    await open();
    await page
      .getByRole('article', { name: 'Enter the garden' })
      .getByRole('button', { name: 'Open Enter the garden' })
      .click();
    const modal = page.getByRole('dialog', { name: 'Enter the garden' });
    await expect(modal.getByText(/Waiting for Gate/)).toBeVisible();
    await expect(
      modal.getByRole('button', {
        name: 'Copy scene orchestrator planner prompt',
      }),
    ).toHaveCount(0);
    await page.screenshot({ path: 'test-results/owner-resolve-before.png' });
    await modal
      .getByRole('button', { name: 'Mark Gate resolved (owner)' })
      .click();
    // The service accepted the owner cookie and the card moved on to planning.
    await expect(modal.getByText(/Waiting for Gate/)).toHaveCount(0);
    await expect(
      modal.getByRole('button', { name: 'Mark Gate resolved (owner)' }),
    ).toHaveCount(0);
    await expect(
      modal.getByRole('button', {
        name: 'Copy scene orchestrator planner prompt',
      }),
    ).toBeVisible();
    await expect(modal.getByText('Resolved by owner')).toBeVisible();
    await page.screenshot({ path: 'test-results/owner-resolve-after.png' });
  } finally {
    await foundry.stop();
    await clean();
  }
});

test('the card says Not live when Mesh Foundry cannot be reached', async ({
  page,
}) => {
  const { id, open, clean } = await board(page, true);
  const foundry = await unacceptedFoundry();
  try {
    await selectAndSyncGate(id, 'garden');
    await foundry.stop();
    await open();
    await page
      .getByRole('article', { name: 'Enter the garden' })
      .getByRole('button', { name: 'Open Enter the garden' })
      .click();
    const modal = page.getByRole('dialog', { name: 'Enter the garden' });
    await expect(modal.getByText(/Not live/)).toBeVisible();
    await expect(modal.getByText(/last recorded state/)).toBeVisible();
    // It never blocks the owner: the recorded state still offers the action.
    await expect(
      modal.getByRole('button', { name: 'Mark Gate resolved (owner)' }),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/not-live.png' });
  } finally {
    await clean();
  }
});

test('the Project Vision panel shows the stored design direction read-only', async ({
  page,
}) => {
  const { publish, open, clean } = await board(page);
  try {
    publish({
      type: 'project.design-direction.set',
      designDirection: {
        name: 'Signal Ledger',
        summary: 'Dense ink-on-paper tables with one hot accent.',
        palette: ['#101418 ink', '#f2efe6 paper', '#ff4f1f accent'],
        typePairing: 'Space Grotesk headings, IBM Plex Mono data',
        layoutIdea: 'Left rail index with a wide ledger column.',
        sources: [
          {
            url: 'https://example.com/ledger',
            observedTrait: 'Hairline rules',
          },
        ],
        rejectedAlternatives: ['Glassy dashboard: too close to a sibling.'],
        chosenAt: '2026-11-22T10:00:00.000Z',
      },
    });
    await open();
    await page
      .getByRole('button', { name: /Project Vision/ })
      .first()
      .click();
    const panel = page.getByRole('complementary', { name: 'Project Vision' });
    const direction = panel.getByRole('region', { name: 'Design direction' });
    await expect(direction).toContainText('Signal Ledger');
    await expect(direction).toContainText('#ff4f1f accent');
    await expect(direction).toContainText('Hairline rules');
    await expect(direction.getByRole('button')).toHaveCount(0);
    await direction.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/design-direction.png' });
  } finally {
    await clean();
  }
});
