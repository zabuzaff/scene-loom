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
          scene: scene('station', 'The station'),
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
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page
      .getByRole('button', { name: 'Open Arrival', exact: true })
      .click();
    await expect(arrival.getByText('Keep the reveal slow.')).toBeVisible();
    await arrival.getByRole('button', { name: 'Continue from here' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Continue prompt copied',
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      `Scene: Arrival (arrival)`,
    );
    await arrival
      .getByRole('button', { name: 'Copy edit prompt for Arrival' })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      'Revise this scene in place',
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
          changes: { title: 'Arrival revised' },
        },
      ],
    };
    input('project', 'apply', id);
    await page.mouse.up();
    await expect(
      page.getByRole('article', { name: 'Arrival revised', exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => cli('project', 'read', id).data.layoutRevision)
      .toBeGreaterThan(0);
    const state = cli('project', 'read', id).data;
    expect(state.positions.arrival.x).not.toBe(0);
    expect(state.scenes[0].title).toBe('Arrival revised');
    expect(state.vision.summary).toBe(visionFixture.summary);
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'Arrival revised', exact: true }),
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
      page.getByRole('article', { name: 'Arrival revised', exact: true }),
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
        page.getByRole('article', { name: 'Arrival revised', exact: true }),
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
      ],
    });
    await call(
      'projects/restart/layout',
      { expectedLayoutRevision: 0, positions: { scene: { x: 120, y: 240 } } },
      'PATCH',
    );
    await page.goto('http://127.0.0.1:4320');
    await expect(
      page.getByRole('article', { name: 'Persistent scene', exact: true }),
    ).toBeVisible();
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
    expect(latest.positions.scene).toEqual({ x: 120, y: 240 });
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
    await page.getByRole('button', { name: 'Copy first scene prompt' }).click();
    const resume = await page.evaluate(() => navigator.clipboard.readText());
    expect(resume).toContain('Resume from the saved Project Vision');
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
