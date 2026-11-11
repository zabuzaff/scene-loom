import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { visionFixture } from '../vision-fixture';

test('real CLI ingestion → canvas → copy prompts → drag + live edit → persisted state', async ({
  page,
}) => {
  const root = '/private/tmp/scene-loom-browser-tests';
  const temp = await mkdtemp(join(tmpdir(), 'scene-loom-ui-'));
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'cli/index.ts', ...args],
        {
          encoding: 'utf8',
          env: { ...process.env, SCENE_LOOM_DATA_DIR: root },
        },
      ),
    );
  const input = (...args: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'cli/index.ts', ...args, '-'],
        {
          input: JSON.stringify(nextInput),
          encoding: 'utf8',
          env: { ...process.env, SCENE_LOOM_DATA_DIR: root },
        },
      ),
    );
  let nextInput: unknown;
  const id = `ui_${randomUUID()}`,
    title = `Browser test ${id.slice(-8)}`;
  try {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'How to use Scene Loom' }),
    ).toBeVisible();
    nextInput = { id, title };
    expect(input('project', 'create').success).toBe(true);
    const path = join(temp, 'scene.png');
    await sharp({
      create: { width: 720, height: 440, channels: 3, background: '#38544e' },
    })
      .png()
      .toFile(path);
    nextInput = { path };
    const asset = input('asset', 'import', id).data;
    const scene = (sceneId: string, title: string) => ({
      id: sceneId,
      title,
      description: 'The player discovers a quiet coastal station.',
      notes: 'Keep the reveal slow.',
      mainAssetId: asset.id,
      supportingAssetIds: [asset.id],
    });
    nextInput = {
      schemaVersion: 1,
      projectId: id,
      requestId: 'create',
      expectedContentRevision: 0,
      operations: [
        { type: 'scene.create', scene: scene('arrival', 'Arrival') },
        {
          type: 'scene.create',
          scene: {
            ...scene('station', 'The station'),
            mainAssetId: undefined,
            supportingAssetIds: [],
          },
          placement: { nearSceneId: 'arrival' },
        },
        {
          type: 'connection.create',
          connection: {
            id: 'next',
            sourceSceneId: 'arrival',
            targetSceneId: 'station',
            label: 'Explore',
          },
        },
      ],
    };
    expect(input('project', 'apply', id).success).toBe(true);
    await page.locator('.project-trigger').click();
    await page.getByRole('button', { name: `${title} 2 scenes` }).click();
    const arrival = page.getByRole('article', { name: 'Arrival', exact: true });
    await expect(arrival).toBeVisible();
    const planningScene = page.getByRole('article', {
      name: 'The station',
      exact: true,
    });
    await expect(planningScene.getByText('02 · Text scene')).toBeVisible();
    await expect(
      planningScene.getByText('The player discovers a quiet coastal station.'),
    ).toBeVisible();
    await expect(planningScene.locator('img')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/text-only-planning-card.png' });
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const handoffButton = arrival.getByRole('button', {
      name: 'Copy asset-generation prompt for Arrival',
    });
    const picker = page.locator('.project-trigger');
    const actions = page.getByRole('button', { name: 'Project actions' });
    async function openProjectActions() {
      await picker.click();
      await actions.click();
    }
    const meshSetting = page.getByRole('switch', {
      name: 'Mesh Foundry handoff',
    });
    const initialProject = cli('project', 'read', id).data;
    await openProjectActions();
    await page
      .getByRole('button', { name: 'Copy plan development prompt' })
      .click();
    const plan = await page.evaluate(() => navigator.clipboard.readText());
    expect(plan).toContain(`Scene Loom project: ${title} (${id})`);
    expect(plan).toContain(
      "Write the plan in the target repository's Markdown",
    );
    expect(plan).toContain(
      'Do not edit application code or implement the slice',
    );
    expect(plan).toContain(
      'extract only broad visual cues such as palette, contrast, restraint, and overall aesthetic',
    );
    expect(plan).toContain(
      'compare both widely used products and recent product launches or redesigns',
    );
    expect(plan).toContain(
      'For new or explicitly redesigned surfaces, use live web research',
    );
    expect(plan).toContain(
      'Prioritize the most recent comparable designs you can verify',
    );
    expect(plan).toContain(
      'dated screenshots, walkthroughs, or redesign notes that actually show the pattern',
    );
    expect(plan).toContain('design an original interface for this project');
    expect(plan).toContain('I authorize browsing official documentation');
    expect(plan).toContain('Choose the frontend and backend frameworks');
    expect(plan).toContain('database or persistence approach');
    expect(plan).toContain('frontend component library autonomously');
    await openProjectActions();
    await page
      .getByRole('button', { name: 'Copy review development plan prompt' })
      .click();
    const review = await page.evaluate(() => navigator.clipboard.readText());
    expect(review).toContain(`Scene Loom project: ${title} (${id})`);
    expect(review).toContain('Give a Ready or Needs revision verdict');
    expect(review).toContain(
      'SHA-256 of the exact bytes reviewed for each plan file',
    );
    expect(review).toContain(
      'Check that the planned scope and acceptance checks cover',
    );
    for (const prompt of [plan, review]) {
      expect(prompt).toContain('shared layouts and route transitions');
      expect(prompt).toContain('verify the effective local datastore');
    }
    expect(review).toContain(
      'without editing the plan or implementing anything',
    );
    await openProjectActions();
    await page
      .getByRole('button', { name: 'Copy start development prompt' })
      .click();
    const development = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(development).toContain(`Scene Loom project: ${title} (${id})`);
    expect(development).toContain(
      'including Project Vision, all scenes, notes, and connections',
    );
    expect(development).toContain(
      'Start development from the reviewed Markdown plan',
    );
    expect(development).toContain(
      'report what is needed and stop before coding',
    );
    expect(development).toContain(
      'Review result (paste here or give its location)',
    );
    expect(development).toContain('Require a Ready verdict');
    expect(development).toContain(
      'Recompute the SHA-256 of each current plan file',
    );
    expect(development).toContain('implement it in this session');
    expect(development).toContain('Build a working implementation by default');
    expect(development).toContain(
      'populate its normal local datastore with realistic fictional records',
    );
    expect(development).toContain(
      'Keep seeding local, idempotent, and non-destructive',
    );
    expect(development).toContain('run it before handoff');
    expect(development).toContain(
      'verify the effective datastore for that exact invocation',
    );
    expect(development).toContain(
      'configure a confirmed local datastore through the normal startup path',
    );
    expect(development).toContain(
      'Use that same local configuration for seeding, browser verification, and the startup instructions',
    );
    expect(development).toContain(
      'Keep unverified scene images unopened by default',
    );
    expect(development).toContain(
      'establish and briefly record an independent design direction before coding',
    );
    expect(development).toContain(
      'in scene descriptions or notes as illustrative unless I explicitly approved them as requirements',
    );
    expect(development).not.toContain(
      'Inspect relevant full-resolution storyboard images as needed',
    );
    expect(development).toContain(
      'Do not build a separate preview or demo feature, mode, route, environment, or startup command',
    );
    expect(development).toContain(
      'Do not substitute simulated success for a working feature',
    );
    expect(development).toContain(
      'Identify synced scenes from a current Repository verification record',
    );
    expect(development).toContain(
      'treat storyboard images and provisional visual directions as creative references',
    );
    expect(development).toContain(
      'use the storyboard as the baseline for established flows and screens within the verified scope',
    );
    expect(development).toContain(
      'An existing repository alone does not prove that a storyboard is synced',
    );
    expect(development).toContain(
      'using a maintained, accessible UI component library is mandatory',
    );
    expect(development).toContain(
      'Verify the library is used in rendered screens',
    );
    expect(development).not.toContain('component library where needed');
    expect(development).toContain(
      'verify the primary user flow end to end in a browser',
    );
    expect(development).toContain(
      'Use the normal running application and its seeded local data',
    );
    expect(development).toContain(
      'including desktop and mobile for responsive web apps',
    );
    expect(development).toContain('complete the primary flow with a keyboard');
    expect(development).toContain('report browser verification as incomplete');
    expect(development).toContain('Do not build custom frameworks');
    expect(development).toContain('Use Scene Loom as a read-only reference');
    await openProjectActions();
    await page
      .getByRole('button', { name: 'Copy resync with repository prompt' })
      .click();
    const resync = await page.evaluate(() => navigator.clipboard.readText());
    expect(resync).toContain(`Scene Loom project: ${title} (${id})`);
    expect(resync).toContain('Treat the repository as read-only');
    expect(resync).toContain(
      'Review the numbering across the whole storyboard',
    );
    expect(resync).toContain('1.2.1 for a child of 1.2');
    expect(resync).toContain('attach it to the same scene via mainAssetId');
    expect(resync).toContain('has an outdated or speculative main image');
    expect(resync).toContain(
      'Use the newly imported ID in the verification record',
    );
    expect(resync).toContain('Keep planned or partially implemented scenes');
    expect(resync).toContain(
      'including one whose image and description already match',
    );
    expect(resync).toContain(
      'add or update a single Repository verification block',
    );
    expect(resync).toContain(
      'use it as expectedContentRevision for both the dry run and publication',
    );
    expect(resync).toContain(
      'recompute the affected changes against the fresh content while preserving intervening edits',
    );
    expect(resync).toContain('SCENE_LOOM_DATA_DIR');
    expect(cli('project', 'read', id).data).toEqual(initialProject);

    await expect(handoffButton).toHaveCount(0);
    await openProjectActions();
    await expect(meshSetting).not.toBeChecked();
    await meshSetting.click();
    await expect(meshSetting).toBeChecked();
    await page.screenshot({
      path: 'test-results/mesh-foundry-project-setting.png',
    });
    await picker.click();
    await page.reload();
    await expect(handoffButton).toBeVisible();
    await expect(
      planningScene.getByRole('button', {
        name: 'Copy asset-generation prompt for The station',
      }),
    ).toHaveCount(0);

    const standaloneTitle = `${title} standalone`;
    nextInput = { id: `${id}_standalone`, title: standaloneTitle };
    expect(input('project', 'create').success).toBe(true);
    await picker.click();
    await page
      .getByRole('button', { name: `${standaloneTitle} 0 scenes` })
      .click();
    await expect(picker).toHaveText(standaloneTitle);
    await openProjectActions();
    await expect(
      page.getByRole('button', { name: 'Copy start development prompt' }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Copy resync with repository prompt' })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      `Scene Loom project: ${standaloneTitle} (${id}_standalone)`,
    );
    await openProjectActions();
    await expect(meshSetting).not.toBeChecked();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: `${title} 2 scenes` }).click();
    await expect(handoffButton).toBeVisible();
    await openProjectActions();
    await meshSetting.click();
    await expect(meshSetting).not.toBeChecked();
    await expect(handoffButton).toHaveCount(0);
    await meshSetting.click();
    await expect(meshSetting).toBeChecked();
    await picker.click();

    // A long library must scroll independently of its search and footer.
    const viewport = page.viewportSize()!;
    await page.route('**/api/projects', async (route) => {
      const response = await route.fetch();
      const result = await response.json();
      await route.fulfill({
        response,
        json: {
          ...result,
          data: [
            ...result.data,
            ...Array.from({ length: 24 }, (_, index) => ({
              id: `menu_fixture_${index}`,
              title: `Menu fixture ${index + 1}`,
              status: 'ready',
              sceneCount: 0,
              updatedAt: '2026-11-09T00:00:00.000Z',
            })),
          ],
        },
      });
    });
    await page.setViewportSize({ width: 900, height: 450 });
    await page.reload();
    await expect(handoffButton).toBeVisible();
    await picker.click();
    await expect(actions).toBeInViewport({ ratio: 1 });
    const lastProject = page.getByRole('button', {
      name: 'Menu fixture 24 0 scenes',
    });
    await expect(lastProject).not.toBeInViewport();
    await page.locator('.project-menu-list').hover();
    await page.mouse.wheel(0, 4000);
    await expect(lastProject).toBeInViewport({ ratio: 1 });
    await expect(actions).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: 'test-results/project-menu-short-window.png',
    });
    const search = page.getByRole('textbox', { name: 'Search projects' });
    await expect(search).toBeFocused();
    await search.press('Tab');
    const firstResult = page
      .locator('.project-menu-list button:enabled')
      .first();
    await expect(firstResult).toBeFocused();
    await firstResult.press('End');
    await expect(lastProject).toBeFocused();
    await lastProject.press('ArrowUp');
    await expect(
      page.getByRole('button', { name: 'Menu fixture 23 0 scenes' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Copy new project starter prompt' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(actions).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Project Vision' }),
    ).toBeFocused();
    await expect(search).toHaveCount(0);
    await picker.click();
    await search.fill('  menu FIXTURE 24 ');
    await expect(page.locator('.project-menu-list button')).toHaveCount(1);
    await search.press('ArrowDown');
    await expect(lastProject).toBeFocused();
    await search.fill('no matches for this');
    await expect(page.getByText('No matching projects.')).toBeVisible();
    await search.press('Escape');
    await expect(picker).toBeFocused();
    await expect(search).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 720 });
    await picker.click();
    await expect(search).toHaveValue('');
    const switcher = page.getByRole('region', { name: 'Switch project' });
    await expect(switcher).toHaveCSS('opacity', '1');
    const panel = await switcher.boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/project-switcher-narrow.png' });
    await page.mouse.click(4, 650);
    await expect(search).toHaveCount(0);
    await picker.click();
    await search.fill(standaloneTitle);
    await search.press('Enter');
    await expect(picker).toHaveText(standaloneTitle);
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await picker.click();
    await search.fill(title);
    await search.press('Enter');
    await expect(picker).toHaveText(title);
    await page.unroute('**/api/projects');
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(handoffButton).toBeVisible();

    const beforeHandoff = cli('project', 'read', id).data;
    expect(beforeHandoff).toEqual({
      ...initialProject,
      meshFoundryEnabled: true,
    });
    await arrival
      .getByRole('button', { name: 'Copy asset-generation prompt for Arrival' })
      .click();
    const handoff = await page.evaluate(() => navigator.clipboard.readText());
    expect(handoff).toContain(`Source project: ${title} (${id})`);
    expect(handoff).toContain('Source scene: Arrival (arrival)');
    expect(handoff).toContain('WAIT for explicit confirmation');
    expect(handoff).toContain('reread the Scene Loom source before generating');
    expect(handoff).toContain(
      'Immediately before publishing, reread the Scene Loom source again',
    );
    expect(handoff).toContain(
      'Pause publication for any material change and get renewed confirmation',
    );
    expect(handoff).toContain(
      'Open and visually inspect the actual full-resolution main image',
    );
    expect(handoff).toContain('Publish only stage "sketch"');
    expect(handoff).toContain('STOP after the 2D concepts are published');
    expect(handoff).toContain('SCENE_LOOM_DATA_DIR');
    await expect(
      arrival.getByRole('button', { name: 'Open Arrival', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(cli('project', 'read', id).data).toEqual(beforeHandoff);
    await page.screenshot({ path: 'test-results/asset-handoff-collapsed.png' });

    await page
      .getByRole('button', { name: 'Open Arrival', exact: true })
      .click();
    await expect(arrival.getByText('Keep the reveal slow.')).toBeVisible();
    await arrival
      .getByRole('button', { name: 'Copy asset-generation prompt for Arrival' })
      .click();
    await expect(
      arrival.getByRole('button', { name: 'Collapse Arrival' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: 'test-results/asset-handoff-expanded.png' });

    await arrival.getByRole('button', { name: 'Continue from here' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Continue prompt copied',
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      `Scene: Arrival (arrival)`,
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      'default to a text-only planning scene',
    );
    await arrival
      .getByRole('button', { name: 'Copy edit prompt for Arrival' })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      'Revise this scene in place',
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      'default to a text-only planning scene',
    );
    await page.getByRole('button', { name: 'Collapse Arrival' }).click();
    const image = arrival.locator('.scene-image');
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 80, box!.y + 70);
    await page.mouse.down();
    await page.mouse.move(box!.x + 180, box!.y + 150, { steps: 12 });
    nextInput = {
      schemaVersion: 1,
      projectId: id,
      requestId: 'edit',
      expectedContentRevision: 1,
      operations: [
        {
          type: 'project.vision.set',
          vision: { ...visionFixture, name: title },
        },
        {
          type: 'scene.patch',
          id: 'arrival',
          changes: { title: '1 — Arrival revised' },
        },
        {
          type: 'scene.patch',
          id: 'station',
          changes: { mainAssetId: asset.id },
        },
      ],
    };
    input('project', 'apply', id);
    await page.mouse.up();
    await expect(
      page.getByRole('article', { name: '1 — Arrival revised', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => cli('project', 'read', id).data.layoutRevision)
      .toBeGreaterThan(0);
    const state = cli('project', 'read', id).data;
    expect(state.positions.arrival.x).not.toBe(0);
    expect(state.scenes[0].title).toBe('1 — Arrival revised');
    await expect(
      page
        .getByRole('article', { name: '1 — Arrival revised', exact: true })
        .locator('.scene-number'),
    ).toHaveCount(0);
    await expect(
      planningScene.getByRole('img', { name: 'The station' }),
    ).toBeVisible();
    await expect(
      planningScene.getByRole('button', {
        name: 'Copy asset-generation prompt for The station',
      }),
    ).toBeVisible();
    expect(state.positions.station).toEqual(initialProject.positions.station);
    expect(state.vision.summary).toBe(visionFixture.summary);
    await page.reload();
    await expect(
      page.getByRole('article', { name: '1 — Arrival revised', exact: true }),
    ).toBeVisible();
    expect(cli('project', 'read', id).data.positions.arrival).toEqual(
      state.positions.arrival,
    );
    const keyboardNode = page.locator('.react-flow__node[data-id="arrival"]');
    await keyboardNode.focus();
    if (!(await keyboardNode.getAttribute('class'))?.includes('selected'))
      await page.keyboard.press('Enter');
    const beforeKeyboard = cli('project', 'read', id).data;
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => cli('project', 'read', id).data.positions.arrival.x)
      .toBe(beforeKeyboard.positions.arrival.x + 15);
    await page.reload();
    await expect(
      page.getByRole('article', { name: '1 — Arrival revised', exact: true }),
    ).toBeVisible();
    expect(cli('project', 'read', id).data.positions.arrival.x).toBe(
      beforeKeyboard.positions.arrival.x + 15,
    );
    const beforeQueuedMove = cli('project', 'read', id).data.positions.arrival
      .x;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let holdLists = true,
      listsBlocked = 0;
    await page.route('**/api/projects', async (route) => {
      if (holdLists) {
        listsBlocked++;
        await refreshGate;
      }
      await route.continue();
    });
    try {
      await keyboardNode.focus();
      if (!(await keyboardNode.getAttribute('class'))?.includes('selected'))
        await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      // Both the SSE-triggered refresh and the save's own refresh must wait.
      await expect.poll(() => listsBlocked).toBeGreaterThanOrEqual(2);
      await page.keyboard.press('ArrowRight');
      holdLists = false;
      releaseRefresh();
      await expect
        .poll(() => cli('project', 'read', id).data.positions.arrival.x)
        .toBe(beforeQueuedMove + 10);
      await page.reload();
      await expect(
        page.getByRole('article', { name: '1 — Arrival revised', exact: true }),
      ).toBeVisible();
      expect(cli('project', 'read', id).data.positions.arrival.x).toBe(
        beforeQueuedMove + 10,
      );
    } finally {
      holdLists = false;
      releaseRefresh();
      await page.unroute('**/api/projects');
    }
    await page.getByRole('button', { name: 'Find a scene' }).click();
    const searchInput = page.getByPlaceholder('Search scene titles…');
    await expect(searchInput).toBeFocused();
    expect(
      await searchInput.evaluate(
        (input) => getComputedStyle(input).outlineStyle,
      ),
    ).toBe('none');
    await searchInput.fill('station');
    await page
      .getByRole('button', { name: 'The station', exact: true })
      .click();
    await expect(
      page.getByRole('article', { name: 'The station', exact: true }),
    ).toBeVisible();
    const station = page.getByRole('article', {
      name: 'The station',
      exact: true,
    });
    await expect(
      station.getByRole('button', { name: 'Collapse The station' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(station.getByText('Keep the reveal slow.')).toBeVisible();
    await expect(searchInput).not.toBeVisible();
    await expect(
      page.locator('.react-flow__node[data-id="station"]'),
    ).toHaveClass(/selected/);
    await page.waitForTimeout(850);
    const searchBounds = await station.boundingBox();
    await station.locator('.scene-image').click();
    await expect(
      station.getByRole('button', { name: 'Open The station' }),
    ).toBeVisible();
    await station.locator('.scene-image').click();
    await page.waitForTimeout(850);
    const clickBounds = await station.boundingBox();
    expect(Math.abs(searchBounds!.x - clickBounds!.x)).toBeLessThan(2);
    expect(Math.abs(searchBounds!.y - clickBounds!.y)).toBeLessThan(2);
    // Search must refocus an already-open card after the user has zoomed out.
    await page.getByRole('button', { name: 'Fit all scenes' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Find a scene' }).click();
    await searchInput.fill('station');
    await page
      .getByRole('button', { name: 'The station', exact: true })
      .click();
    await page.waitForTimeout(850);
    const refocusedBounds = await station.boundingBox();
    expect(Math.abs(searchBounds!.x - refocusedBounds!.x)).toBeLessThan(2);
    expect(Math.abs(searchBounds!.y - refocusedBounds!.y)).toBeLessThan(2);
    await page.screenshot({ path: 'test-results/search-scene-focus.png' });
    await page.getByRole('button', { name: 'Fit all scenes' }).click();
    await page.screenshot({ path: 'test-results/studio-desktop.png' });
    expect(errors).toEqual([]);
    const largeOps: unknown[] = Array.from({ length: 98 }, (_, i) => ({
      type: 'scene.create',
      scene: scene(`extra_${i}`, `Scene ${i + 3}`),
    }));
    const sceneIds = [
      'arrival',
      'station',
      ...Array.from({ length: 98 }, (_, i) => `extra_${i}`),
    ];
    for (let i = 0; i < 149; i++)
      largeOps.push({
        type: 'connection.create',
        connection: {
          id: `perf_${i}`,
          sourceSceneId: sceneIds[i % 100],
          targetSceneId: sceneIds[(i + 1) % 100],
        },
      });
    nextInput = {
      schemaVersion: 1,
      projectId: id,
      requestId: 'large_fixture',
      expectedContentRevision: 2,
      operations: largeOps,
    };
    expect(input('project', 'apply', id).success).toBe(true);
    nextInput = {
      expectedLayoutRevision: cli('project', 'read', id).data.layoutRevision,
      positions: Object.fromEntries(
        sceneIds.map((id, i) => [
          id,
          { x: (i % 10) * 420, y: Math.floor(i / 10) * 430 },
        ]),
      ),
    };
    input('layout', 'patch', id);
    await expect(page.locator('.react-flow__node')).toHaveCount(100);
    await expect(page.locator('.react-flow__edge')).toHaveCount(150);
    await page.getByRole('button', { name: 'Fit all scenes' }).click();
    await page.waitForTimeout(500);
    const [intervals] = await Promise.all([
      page.evaluate(async () => {
        const times: number[] = [];
        let last = performance.now();
        await new Promise<void>((resolve) => {
          const start = last;
          function frame(now: number) {
            times.push(now - last);
            last = now;
            if (now - start < 500) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
        return times;
      }),
      (async () => {
        await page.mouse.move(1150, 820);
        await page.mouse.down();
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(1150 - i * 8, 820 - i * 3);
          await page.waitForTimeout(10);
        }
        await page.mouse.up();
      })(),
    ]);
    console.log(
      JSON.stringify({
        fixture: '100 scenes / 150 connections',
        frames: intervals.length,
        medianFrameIntervalMs: intervals.sort((a, b) => a - b)[
          Math.floor(intervals.length / 2)
        ],
      }),
    );
    await page.screenshot({ path: 'test-results/studio-100-scenes.png' });

    const runtime = JSON.parse(
      await readFile(join(root, 'runtime.json'), 'utf8'),
    );
    const response = await fetch(`${runtime.url}/api/projects/${id}`, {
      headers: { Authorization: `Bearer ${runtime.token}` },
    });
    expect(response.ok).toBe(true);
  } finally {
    await rm(temp, { recursive: true, force: true });
    await rm(join(root, 'projects', id), { recursive: true, force: true });
    await rm(join(root, 'projects', `${id}_standalone`), {
      recursive: true,
      force: true,
    });
  }
});

test('viewer reconnects after a real service restart with owned images and saved layout intact', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'scene-loom-restart-'));
  let service: ChildProcess | undefined;
  const start = async () => {
    service = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      {
        env: {
          ...process.env,
          SCENE_LOOM_DATA_DIR: root,
          SCENE_LOOM_PORT: '4320',
        },
        stdio: 'ignore',
      },
    );
    await expect
      .poll(
        async () => {
          try {
            const r = JSON.parse(
              await readFile(join(root, 'runtime.json'), 'utf8'),
            );
            return (await fetch(`${r.url}/api/session`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 20000 },
      )
      .toBe(true);
  };
  const stop = async () => {
    if (service && service.exitCode === null) {
      const exited = once(service, 'exit');
      service.kill('SIGTERM');
      await exited;
    }
  };
  try {
    await start();
    const runtime = JSON.parse(
      await readFile(join(root, 'runtime.json'), 'utf8'),
    );
    const call = async (path: string, body: unknown, method = 'POST') => {
      const r = await fetch(`${runtime.url}/api/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${runtime.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      expect(r.ok).toBe(true);
      return (await r.json()).data;
    };
    await call('projects', { id: 'restart', title: 'Restart test' });
    const image = join(root, 'image.png');
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#524b38' },
    })
      .png()
      .toFile(image);
    const asset = await call('projects/restart/assets', { path: image });
    await call('projects/restart/apply', {
      schemaVersion: 1,
      projectId: 'restart',
      requestId: 'seed',
      expectedContentRevision: 0,
      operations: [
        {
          type: 'scene.create',
          scene: {
            id: 'scene',
            title: 'Persistent scene',
            description: 'Survives restart',
            notes: '',
            mainAssetId: asset.id,
            supportingAssetIds: [],
          },
        },
        {
          type: 'scene.create',
          scene: {
            id: 'upper',
            title: 'Next scene',
            description: 'Branches into the next scene',
            notes: '',
            supportingAssetIds: [],
          },
        },
        ...['branch', 'join', 'detached'].map((id) => ({
          type: 'scene.create',
          scene: {
            id,
            title: id,
            description: id,
            notes: '',
            supportingAssetIds: [],
          },
        })),
        ...[
          { id: 'split', sourceSceneId: 'scene', targetSceneId: 'branch' },
          { id: 'join-a', sourceSceneId: 'upper', targetSceneId: 'join' },
          {
            id: 'join-b',
            sourceSceneId: 'branch',
            targetSceneId: 'join',
            label: 'Continue from the branch into the confirmed shared result',
          },
          {
            id: 'down',
            sourceSceneId: 'scene',
            targetSceneId: 'upper',
            label: 'Next',
          },
          {
            id: 'back',
            sourceSceneId: 'upper',
            targetSceneId: 'scene',
            label: 'Return',
          },
          {
            id: 'loop',
            sourceSceneId: 'scene',
            targetSceneId: 'scene',
            label: 'Repeat',
          },
        ].map((connection) => ({ type: 'connection.create', connection })),
      ],
    });
    await call(
      'projects/restart/layout',
      {
        expectedLayoutRevision: 0,
        positions: { scene: { x: 120, y: 240 }, upper: { x: 120, y: 680 } },
      },
      'PATCH',
    );
    await page.goto('http://127.0.0.1:4320');
    await expect(
      page.getByRole('article', { name: 'Persistent scene', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Copy asset-generation prompt for Persistent scene',
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Copy edit prompt for Persistent scene',
      }),
    ).toBeVisible();
    const endpoints = (edgeId: string, from: string, to: string) =>
      page
        .getByTestId(`rf__edge-${edgeId}`)
        .locator('path.react-flow__edge-path')
        .evaluate(
          (element, { from, to }) => {
            const path = element as SVGPathElement;
            const matrix = path.getScreenCTM()!;
            const near = (selector: string, length: number) => {
              const handle = document
                .querySelector(selector)
                ?.getBoundingClientRect();
              const point = path
                .getPointAtLength(length)
                .matrixTransform(matrix);
              return (
                !!handle &&
                Math.hypot(
                  point.x - handle.x - handle.width / 2,
                  point.y - handle.y - handle.height / 2,
                ) < 8
              );
            };
            return near(from, 0) && near(to, path.getTotalLength());
          },
          { from, to },
        );
    const port = (id: string, side: string) =>
      `.react-flow__node[data-id="${id}"] .react-flow__handle[data-handleid="${side}"]`;
    await expect
      .poll(() =>
        endpoints('down', port('scene', 'bottom'), port('upper', 'top')),
      )
      .toBe(true);
    await expect
      .poll(() =>
        endpoints('back', port('upper', 'left'), port('scene', 'left')),
      )
      .toBe(true);
    await expect
      .poll(() =>
        endpoints('loop', port('scene', 'top'), port('scene', 'right')),
      )
      .toBe(true);
    await page.screenshot({ path: 'test-results/four-sided-connections.png' });
    await call(
      'projects/restart/layout',
      {
        expectedLayoutRevision: 1,
        positions: { upper: { x: 580, y: 240 } },
      },
      'PATCH',
    );
    await expect
      .poll(() =>
        endpoints('down', port('scene', 'right'), port('upper', 'left')),
      )
      .toBe(true);
    const readBoard = async () =>
      JSON.parse(
        await readFile(join(root, 'projects/restart/project.json'), 'utf8'),
      );
    const arrangeButton = page.getByRole('button', { name: 'Arrange scenes' });
    const beforeConflict = await readBoard();
    await page.route(
      '**/projects/restart/layout',
      async (route) => {
        await call('projects/restart/apply', {
          schemaVersion: 1,
          projectId: 'restart',
          requestId: 'during-arrange',
          expectedContentRevision: beforeConflict.contentRevision,
          operations: [
            {
              type: 'scene.create',
              scene: {
                id: 'added',
                title: 'Added during arrange',
                description: '',
                notes: '',
                supportingAssetIds: [],
              },
            },
          ],
        });
        await route.continue();
      },
      { times: 1 },
    );
    await arrangeButton.click();
    await expect(
      page.getByText(
        'The board changed while arranging. Click Arrange scenes to try again.',
      ),
    ).toBeVisible();
    await expect(arrangeButton).toBeEnabled();
    const beforeArrange = await readBoard();
    expect(beforeArrange.layoutRevision).toBe(beforeConflict.layoutRevision);
    for (const [id, position] of Object.entries(beforeConflict.positions))
      expect(beforeArrange.positions[id]).toEqual(position);
    const movingCard = page.locator('.react-flow__node[data-id="scene"]');
    const startTransform = await movingCard.evaluate(
      (el) => el.style.transform,
    );
    const layoutRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().endsWith('/projects/restart/layout')
      )
        layoutRequests.push(request.url());
    });
    const frames = await arrangeButton.evaluate(async (button) => {
      const card = document.querySelector<HTMLElement>(
        '.react-flow__node[data-id="scene"]',
      )!;
      const transforms: string[] = [];
      (button as HTMLButtonElement).click();
      for (let frame = 0; frame < 10; frame++) {
        await new Promise(requestAnimationFrame);
        transforms.push(card.style.transform);
      }
      return transforms;
    });
    expect(
      new Set(frames.filter((frame) => frame !== startTransform)).size,
    ).toBeGreaterThan(1);
    expect(layoutRequests).toHaveLength(0);
    await expect(arrangeButton).toBeEnabled();
    await expect.poll(async () => (await readBoard()).layoutRevision).toBe(3);
    expect(layoutRequests).toHaveLength(1);
    const arranged = await readBoard();
    expect(arranged.contentRevision).toBe(beforeArrange.contentRevision);
    expect(arranged.connections).toEqual(beforeArrange.connections);
    expect(arranged.positions.scene.x).toBeLessThan(arranged.positions.upper.x);
    expect(arranged.positions.upper.x).toBe(arranged.positions.branch.x);
    expect(arranged.positions.upper.y).not.toBe(arranged.positions.branch.y);
    expect(arranged.positions.upper.x).toBeLessThan(arranged.positions.join.x);
    expect(arranged.positions.detached.y).toBeGreaterThan(
      arranged.positions.join.y,
    );
    await expect
      .poll(() =>
        endpoints('down', port('scene', 'right'), port('upper', 'left')),
      )
      .toBe(true);
    await expect
      .poll(() =>
        endpoints('back', port('upper', 'left'), port('scene', 'right')),
      )
      .toBe(false);
    const returnPath = page
      .getByTestId('rf__edge-back')
      .locator('path.react-flow__edge-path');
    const avoidsBranch = await returnPath.evaluate((element) => {
      const path = element as SVGPathElement;
      const box = document
        .querySelector('.react-flow__node[data-id="branch"]')!
        .getBoundingClientRect();
      const matrix = path.getScreenCTM()!;
      return Array.from({ length: 101 }, (_, index) =>
        path
          .getPointAtLength((path.getTotalLength() * index) / 100)
          .matrixTransform(matrix),
      ).every(
        ({ x, y }) =>
          x <= box.left || x >= box.right || y <= box.top || y >= box.bottom,
      );
    });
    expect(avoidsBranch).toBe(true);
    await expect
      .poll(() =>
        endpoints('join-a', port('upper', 'right'), port('join', 'left')),
      )
      .toBe(true);
    for (const title of [
      'Persistent scene',
      'Next scene',
      'branch',
      'join',
      'detached',
    ]) {
      await expect(
        page.getByRole('article', { name: title, exact: true }),
      ).toBeInViewport({ ratio: 0.99 });
    }
    const longLabel = page
      .getByTestId('rf__edge-join-b')
      .locator('.story-edge-label');
    await expect(longLabel).toHaveAttribute(
      'title',
      'Continue from the branch into the confirmed shared result',
    );
    expect(
      await longLabel.evaluate(
        (el) => el.scrollWidth > el.clientWidth && el.clientWidth <= 84,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'test-results/arranged-scene-branches.png',
      animations: 'disabled',
    });
    await stop();
    await expect(page.locator('.connection-status')).toContainText(
      'Reconnecting',
    );
    await start();
    await expect(page.locator('.connection-status')).toContainText(
      'Local studio',
      { timeout: 15000 },
    );
    const card = page.getByRole('article', {
      name: 'Persistent scene',
      exact: true,
    });
    await expect(card).toBeVisible();
    expect(
      await card
        .locator('img')
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    ).toBe(true);
    const latest = JSON.parse(
      await readFile(join(root, 'projects/restart/project.json'), 'utf8'),
    );
    expect(latest.positions).toEqual(arranged.positions);
    await card.getByRole('button', { name: 'Continue from here' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      root,
    );
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('an unreadable selected project falls back to healthy projects and reports recovery', async ({
  page,
}) => {
  const root = '/private/tmp/scene-loom-browser-tests';
  const temp = await mkdtemp(join(tmpdir(), 'scene-loom-recovery-ui-'));
  const id = `broken_${randomUUID()}`,
    healthy = `healthy_${randomUUID()}`,
    title = `Healthy ${healthy.slice(-8)}`;
  const runtime = JSON.parse(
    await readFile(join(root, 'runtime.json'), 'utf8'),
  );
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${runtime.url}/api/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    expect(res.ok).toBe(true);
    return (await res.json()).data;
  };
  try {
    await call('projects', { id, title: 'Damaged example' });
    await call('projects', { id: healthy, title });
    const image = join(temp, 'image.png');
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#384a40' },
    })
      .png()
      .toFile(image);
    const asset = await call(`projects/${healthy}/assets`, { path: image });
    await call(`projects/${healthy}/apply`, {
      schemaVersion: 1,
      projectId: healthy,
      requestId: 'seed',
      expectedContentRevision: 0,
      operations: [
        {
          type: 'scene.create',
          scene: {
            id: 'scene',
            title: 'Healthy scene',
            description: 'Still available',
            notes: '',
            mainAssetId: asset.id,
            supportingAssetIds: [],
          },
        },
      ],
    });
    await writeFile(join(root, 'projects', id, 'project.json'), 'null');
    await page.addInitScript(
      (selected) => localStorage.setItem('scene-loom-project', selected),
      id,
    );
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(
      `${id}: needs recovery`,
    );
    await page.locator('.project-trigger').click();
    await expect(
      page.getByRole('button', { name: `${id} Needs recovery` }),
    ).toBeDisabled();
    await page.getByRole('button', { name: `${title} 1 scenes` }).click();
    await expect(
      page.getByRole('article', { name: 'Healthy scene', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('scene-loom-project')),
    ).toBe(healthy);
    await page.screenshot({ path: 'test-results/project-recovery-notice.png' });
  } finally {
    await rm(join(root, 'projects', id), { recursive: true, force: true });
    await rm(join(root, 'projects', healthy), { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
});

test('project vision onboarding, safe prompt targets, live refinement and responsive panel', async ({
  page,
}) => {
  const id = `vision_${randomUUID()}`;
  const title = `Vision onboarding ${id}`;
  const cliInput = (args: string[], input?: unknown) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'cli/index.ts',
          ...args,
          ...(input ? ['-'] : []),
        ],
        {
          encoding: 'utf8',
          input: input ? JSON.stringify(input) : undefined,
          env: {
            ...process.env,
            SCENE_LOOM_DATA_DIR: '/private/tmp/scene-loom-browser-tests',
          },
        },
      ),
    );
  try {
    cliInput(['project', 'create'], { id, title });
    await page.goto('/');
    await page.locator('.project-trigger').first().click();
    await page.getByRole('button', { name: `${title} 0 scenes` }).click();
    const trigger = page.getByRole('button', {
      name: 'Project Vision',
      exact: true,
    });
    await trigger.click();
    const panel = page.getByRole('complementary', { name: 'Project Vision' });
    await expect(
      panel.getByText('No vision yet.', { exact: false }),
    ).toBeVisible();
    await panel
      .getByRole('button', { name: 'Copy define vision prompt' })
      .click();
    let prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(`existing project ${id}`);
    expect(prompt).toContain('PROJECT NAME (optional)');
    expect(prompt).toContain(
      'Treat the current project title as the supplied project name',
    );
    expect(prompt).toContain(
      'a blank PROJECT NAME field does not authorize new naming suggestions',
    );
    expect(prompt).toContain(
      'If a vision already exists when you read current state, preserve it',
    );
    expect(prompt).toContain('up to three consequential questions');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.locator('.project-trigger').first().click();
    await page
      .getByRole('button', { name: 'Copy new project starter prompt' })
      .click();
    prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('Create a NEW software project');
    expect(prompt).toContain('three to six meaningful scenes');
    expect(prompt).toContain('default to a text-only planning scene');
    expect(prompt).toContain(
      'use a game-style illustration for gameplay scenes',
    );
    expect(prompt).not.toContain(id);
    cliInput(['project', 'apply', id], {
      schemaVersion: 1,
      projectId: id,
      requestId: 'vision_first',
      expectedContentRevision: 0,
      operations: [
        {
          type: 'project.vision.set',
          vision: { ...visionFixture, name: `Job Lantern ${id.slice(-6)}` },
        },
      ],
    });
    await page
      .getByRole('button', { name: 'Copy starter storyboard prompt' })
      .click();
    const resume = await page.evaluate(() => navigator.clipboard.readText());
    expect(resume).toContain('Resume from the saved Project Vision');
    expect(resume).toContain('three to six meaningful scenes');
    expect(resume).toContain('default to a text-only planning scene');
    expect(resume).not.toContain('MAIN IDEA (required)');
    await trigger.click();
    await expect(
      panel.getByRole('heading', { name: 'Confirmed decisions' }),
    ).toBeVisible();
    await expect(
      panel.getByText(visionFixture.summary, { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole('button', { name: 'Copy refine vision prompt' })
      .click();
    prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(`(${id})`);
    expect(prompt).toContain('Update the vision only');
    cliInput(['project', 'apply', id], {
      schemaVersion: 1,
      projectId: id,
      requestId: 'vision_second',
      expectedContentRevision: 1,
      operations: [
        {
          type: 'project.vision.set',
          vision: { ...visionFixture, summary: 'A'.repeat(600) },
        },
      ],
    });
    await expect(
      panel.getByText('A'.repeat(600), { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/vision-desktop.png' });
    await page.setViewportSize({ width: 900, height: 700 });
    await page.screenshot({ path: 'test-results/vision-laptop.png' });
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/vision-narrow.png' });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Close Project Vision' }).click();
    await page.reload();
    await trigger.click();
    await expect(
      panel.getByText('A'.repeat(600), { exact: true }),
    ).toBeVisible();
  } finally {
    await rm(join('/private/tmp/scene-loom-browser-tests', 'projects', id), {
      recursive: true,
      force: true,
    });
  }
});
