import { acceptancePreview } from './orchestration.js';
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
  app.get('/api/session', async (_req, reply) => {
    reply.header(
      'Set-Cookie',
      `scene_loom=${token}; HttpOnly; SameSite=Strict; Path=/`,
    );
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
          op.event.record.stage === 'decision',
      )
    )
      fail(
        'OWNER_DECISION_REQUIRED',
        'Plan decisions are retired. Agree to the plan in chat and save the plan.',
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
