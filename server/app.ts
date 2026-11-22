import {
  acceptancePreview,
  checkCardAction,
  workflowStatus,
} from './orchestration.js';
import { sourceIsAccepted } from './foundry.js';
import { nameKey, orchestrationState } from '../shared/orchestration.js';
import { Model } from '../shared/rehearsal.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Store, StudioError, fail } from './store.js';
import { Batch, Id, ImportAsset, schemas } from '../shared/schema.js';
import { repositoryRoot } from '../shared/config.js';
import type { ServerResponse } from 'node:http';

const shellQuote = (value: string) =>
  "'" + value.replaceAll("'", "'\\''") + "'";

export async function createApp(options: {
  root: string;
  port?: number;
  dev?: boolean;
  serve?: boolean;
}) {
  const port = options.port ?? 4318;
  const token = randomBytes(32).toString('hex');
  const store = new Store(options.root);
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  const clients = new Set<ServerResponse>();
  // Owner secret: per service start, never written to runtime.json, never in a
  // response body. Only the browser session flow sets it, as an HttpOnly cookie.
  const ownerSecret = randomBytes(32).toString('hex');
  const ownerEqual = (v: string) =>
    Buffer.byteLength(v) === Buffer.byteLength(ownerSecret) &&
    timingSafeEqual(Buffer.from(v), Buffer.from(ownerSecret));
  const equal = (v: string) =>
    Buffer.byteLength(v) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(v), Buffer.from(token));
  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.has(req.headers.host ?? ''))
      fail('FORBIDDEN_HOST', 'Use the local Scene Loom address.', 403);
    const origin = req.headers.origin;
    if (
      (origin && !origins.has(origin)) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      fail('FORBIDDEN_ORIGIN', 'Cross-origin access is not allowed.', 403);
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin');
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (req.url === '/api/session') return;
    const cookie = /(?:^|;\s*)scene_loom=([a-f0-9]+)/.exec(
      req.headers.cookie ?? '',
    )?.[1];
    const supplied =
      req.headers.authorization?.replace(/^Bearer /, '') ?? cookie ?? '';
    if (!equal(supplied))
      fail(
        'UNAUTHORIZED',
        'A local Scene Loom session is required.',
        401,
        'Reload the studio or restart the CLI using the active data directory.',
      );
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
          location: error.issues[0]?.path.join('.'),
          suggestion:
            'Run the schema command and correct the indicated fields.',
        },
      });
    const e =
      error instanceof StudioError
        ? error
        : new StudioError(
            'INTERNAL_ERROR',
            'The local service could not complete this request.',
            500,
            'Inspect the terminal and retry; your last valid project remains on disk.',
          );
    if (!(error instanceof StudioError)) console.error(error);
    reply.code(e.status).send({
      success: false,
      error: {
        code: e.code,
        message: e.message,
        location: e.location,
        suggestion: e.suggestion,
      },
    });
  });
  const ok = <T>(data: T) => ({ success: true, data });
  app.get('/api/session', async (req, reply) => {
    const cookies = [`scene_loom=${token}; HttpOnly; SameSite=Strict; Path=/`];
    // Requests carrying an Authorization header follow the CLI path and never
    // receive the owner cookie.
    if (!req.headers.authorization)
      cookies.push(
        `scene_loom_owner=${ownerSecret}; HttpOnly; SameSite=Strict; Path=/`,
      );
    reply.header('Set-Cookie', cookies);
    return ok({ token });
  });
  app.get('/api/agent-info', async () =>
    ok({
      root: repositoryRoot,
      cli: `env SCENE_LOOM_DATA_DIR=${shellQuote(options.root)} npm --silent --prefix ${shellQuote(repositoryRoot)} run cli --`,
      guide: join(repositoryRoot, 'docs', 'agent-interface.md'),
    }),
  );
  app.get('/api/schema/:name', async (req) => {
    const name = (req.params as { name: string }).name;
    if (!Object.hasOwn(schemas, name))
      fail('NOT_FOUND', 'Unknown schema.', 404);
    return ok(schemas[name as keyof typeof schemas]());
  });
  app.get('/api/projects', async () => ok(await store.list()));
  app.post('/api/projects', async (req) => ok(await store.create(req.body)));
  app.get('/api/projects/:id', async (req) =>
    ok(await store.read((req.params as { id: string }).id)),
  );
  app.post('/api/projects/:id/storyboards', async (req) =>
    ok(
      await store.createStoryboard((req.params as { id: string }).id, req.body),
    ),
  );
  app.get('/api/projects/:id/scenes/:sceneId', async (req) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const p = await store.read(id);
    const s = p.scenes.find((s) => s.id === sceneId);
    if (!s) fail('NOT_FOUND', 'Scene does not exist.', 404);
    return ok({
      projectId: id,
      contentRevision: p.contentRevision,
      rehearsalInputRevision: p.rehearsalInputRevision ?? p.contentRevision,
      scene: s,
    });
  });
  app.get('/api/projects/:id/scenes/:sceneId/accepted-assets', async (req) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const project = await store.read(id);
    if (!project.meshFoundryEnabled)
      fail(
        'HANDOFF_DISABLED',
        'Enable Mesh Foundry handoff for this storyboard.',
        403,
      );
    const scene = project.scenes.find((scene) => scene.id === sceneId);
    if (!scene) fail('NOT_FOUND', 'Scene does not exist.', 404);
    return ok(await acceptancePreview(project, scene));
  });
  const sceneOf = async (req: { params: unknown }) => {
    const { id, sceneId } = req.params as { id: string; sceneId: string };
    const project = await store.read(id);
    if (!project.meshFoundryEnabled)
      fail(
        'HANDOFF_DISABLED',
        'Enable Mesh Foundry handoff for this storyboard.',
        403,
      );
    const scene = project.scenes.find((scene) => scene.id === sceneId);
    if (!scene) fail('NOT_FOUND', 'Scene does not exist.', 404);
    return { project, scene };
  };
  // Current acceptance read live from Foundry, with the recorded snapshot as
  // the fallback. Never an error when Foundry is unreachable.
  app.get('/api/projects/:id/scenes/:sceneId/workflow', async (req) => {
    const { project, scene } = await sceneOf(req);
    return ok(await workflowStatus(project, scene));
  });
  // An owner-clicked card action is checked against freshly read state.
  app.post('/api/projects/:id/scenes/:sceneId/card-action', async (req) => {
    const { action } = z.object({ action: z.string().max(40) }).parse(req.body);
    const { project, scene } = await sceneOf(req);
    return ok(await checkCardAction(project, scene, action));
  });
  // The owner's authority over a required selection. Only the browser session
  // may use it: it needs the owner cookie, which the CLI token cannot supply.
  app.post(
    '/api/projects/:id/scenes/:sceneId/owner-resolution',
    async (req) => {
      const ownerCookie =
        /(?:^|;\s*)scene_loom_owner=([a-f0-9]+)/.exec(
          req.headers.cookie ?? '',
        )?.[1] ?? '';
      if (
        !req.headers.origin ||
        req.headers.authorization ||
        req.headers['sec-fetch-site'] === 'none' ||
        !ownerEqual(ownerCookie)
      )
        fail(
          'OWNER_ONLY',
          'Only the owner can resolve a selection, from the Scene Loom card.',
          403,
        );
      const body = z
        .strictObject({
          name: z.string().trim().min(1).max(8000),
          source: Model.optional(),
          reason: z.string().trim().min(1).max(8000).optional(),
        })
        .parse(req.body);
      const { project, scene } = await sceneOf(req);
      const state = orchestrationState(
        scene.rehearsalEvents,
        project.rehearsalInputRevision ?? project.contentRevision,
      );
      const entry = state.sync?.entries.find(
        (item) => nameKey(item.name) === nameKey(body.name),
      );
      if (!state.sync || !state.current || !entry)
        fail(
          'STALE_REHEARSAL',
          'This selection is not in the current manifest. Reload the card.',
          409,
        );
      // Default to the revision the owner already pinned for this selection.
      // The owner's own pin is used only if Foundry confirms it right now;
      // otherwise this records a waiver without a source.
      const source =
        body.source ??
        (entry.pinnedSource &&
        (await sourceIsAccepted(entry.pinnedSource).catch(() => false))
          ? entry.pinnedSource
          : undefined);
      const eventId = `owner-${randomUUID()}`;
      return ok(
        await store.apply({
          schemaVersion: 1,
          projectId: project.id,
          requestId: eventId,
          expectedContentRevision: project.contentRevision,
          operations: [
            {
              type: 'rehearsal.record',
              id: scene.id,
              afterEventId: scene.rehearsalEvents?.at(-1)?.eventId ?? null,
              event: {
                kind: 'orchestration',
                eventId,
                record: {
                  stage: 'owner-resolution',
                  syncId: state.sync.eventId,
                  name: entry.name,
                  ...(source ? { source } : {}),
                  prior: entry,
                  ...(body.reason ? { reason: body.reason } : {}),
                },
              },
            },
          ],
        }),
      );
    },
  );
  app.post('/api/projects/:id/assets', async (req) => {
    // Local file import is a trusted CLI capability, never a browser capability.
    if (
      req.headers.origin ||
      req.headers['sec-fetch-site'] ||
      !req.headers.authorization?.startsWith('Bearer ')
    )
      fail('CLI_ONLY', 'Import local files using the agent CLI.', 403);
    const { path, kind } = ImportAsset.parse(req.body);
    return ok(
      await store.importAsset((req.params as { id: string }).id, path, kind),
    );
  });
  app.post('/api/projects/:id/apply', async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    if ((req.body as { projectId?: string })?.projectId !== id)
      fail('PROJECT_MISMATCH', 'Route and batch project IDs differ.');
    const batch = Batch.parse(req.body);
    if (
      batch.operations.some(
        (op) =>
          op.type === 'rehearsal.record' &&
          op.event.kind === 'orchestration' &&
          (op.event.record.stage === 'decision' ||
            op.event.record.stage === 'owner-resolution'),
      )
    )
      fail(
        'OWNER_DECISION_REQUIRED',
        'Agents cannot record plan decisions or resolve selections for the owner. The owner resolves a selection from the Scene Loom card.',
        403,
      );
    return ok(
      await store.apply(
        batch,
        (req.query as { dryRun?: string }).dryRun === 'true',
      ),
    );
  });
  app.put('/api/projects/:id/settings', async (req) => {
    await store.settings((req.params as { id: string }).id, req.body);
    return ok(null);
  });
  app.patch('/api/projects/:id/layout', async (req) =>
    ok(await store.layout((req.params as { id: string }).id, req.body)),
  );
  app.get('/api/projects/:id/viewport', async (req) =>
    ok(await store.viewport((req.params as { id: string }).id)),
  );
  app.put('/api/projects/:id/viewport', async (req) =>
    ok(await store.viewport((req.params as { id: string }).id, req.body)),
  );
  app.get('/api/projects/:id/backups', async (req) =>
    ok(await store.backups((req.params as { id: string }).id)),
  );
  app.post('/api/projects/:id/restore', async (req) =>
    ok(await store.restore((req.params as { id: string }).id, req.body)),
  );
  app.get('/api/projects/:id/assets/:assetId', async (req, reply) => {
    const { id, assetId } = req.params as { id: string; assetId: string };
    const file = await store.assetFile(
      id,
      assetId,
      (req.query as { thumbnail?: string }).thumbnail === 'true',
    );
    await readFile(file).catch(() =>
      fail('NOT_FOUND', 'Stored image is missing.', 404),
    );
    return reply.type('image/webp').send(createReadStream(file));
  });
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write('event: ready\ndata: {}\n\n');
    clients.add(reply.raw);
    const timer = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15000);
    req.raw.on('close', () => {
      clearInterval(timer);
      clients.delete(reply.raw);
    });
  });
  store.on('change', (event) => {
    for (const c of clients)
      c.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  });
  app.addHook('preClose', async () => {
    for (const c of clients) c.end();
  });
  if (options.serve !== false) {
    if (options.dev) {
      const { createServer } = await import('vite');
      const vite = await createServer({
        root: repositoryRoot,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
      });
      app.all('/*', async (req, reply) => {
        if (req.url.startsWith('/api/'))
          fail('NOT_FOUND', 'Unknown API route.', 404);
        const result = await new Promise<'sent' | 'next'>((resolve, reject) => {
          reply.raw.once('finish', () => resolve('sent'));
          vite.middlewares(req.raw, reply.raw, (e?: unknown) =>
            e ? reject(e) : resolve('next'),
          );
        });
        if (result === 'sent') {
          reply.hijack();
          return;
        }
        const html = await vite.transformIndexHtml(
          req.url,
          await readFile(join(repositoryRoot, 'index.html'), 'utf8'),
        );
        return reply.type('text/html').send(html);
      });
      app.addHook('onClose', async () => vite.close());
    } else {
      const plugin = (await import('@fastify/static')).default;
      await app.register(plugin, {
        root: join(repositoryRoot, 'dist'),
        wildcard: false,
      });
      app.setNotFoundHandler(async (req, reply) =>
        req.url.startsWith('/api/')
          ? reply.code(404).send({
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Unknown API route.',
                suggestion: 'Read the agent interface guide.',
              },
            })
          : reply.sendFile('index.html'),
      );
    }
  }
  return { app, store, token };
}
