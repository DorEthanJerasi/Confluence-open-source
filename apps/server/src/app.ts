// Builds the Fastify app. index.ts starts it; tests use app.inject().
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import type { Config } from './env.js';
import type { Db } from './db/client.js';
import { loadSession, SESSION_COOKIE } from './auth/session.js';
import './auth/guard.js';
import { forbidden, registerErrorHandler } from './http.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { spaceRoutes } from './routes/spaces.js';
import { pageRoutes } from './routes/pages.js';
import { attachmentRoutes } from './routes/attachments.js';
import { linkPreviewRoutes } from './routes/linkPreview.js';
import { searchRoutes } from './routes/search.js';
import { aiPageRoutes, aiRoutes } from './routes/ai.js';
import { commentRoutes, pageCommentRoutes } from './routes/comments.js';
import { templateRoutes } from './routes/templates.js';
import { meRoutes, pagePersonalRoutes } from './routes/personal.js';
import { trashRoutes } from './routes/trash.js';
import { taskRoutes } from './routes/tasks.js';
import { startTrashSweep } from './trash/trash.js';
import { createProvider, guardProvider, type AiProvider } from './ai/provider.js';
import type { SafeFetchOptions } from './embeds/safeFetch.js';
import { DiskStorage, type FileStorage } from './files/storage.js';

export interface BuildOptions {
  db: Db;
  config: Config;
  /** Extra health check, e.g. a DB round trip. */
  health?: () => Promise<void>;
  /** true/false, or a level such as 'warn' (index.ts reads LOG_LEVEL). */
  logger?: boolean | { level: string };
  /** Where uploads are kept; default is local disk at config.uploadDir. */
  storage?: FileStorage;
  /** Link-preview fetch settings; tests use them to reach a local stub server. */
  linkPreviewFetch?: SafeFetchOptions;
  /**
   * Overrides createProvider(config.ai): tests inject the stub or a fake.
   * null = AI off. Leave undefined to follow the config.
   */
  aiProvider?: AiProvider | null;
  /**
   * Run the trash purge (purgeExpired) once on start and then every hour,
   * stopped when the app closes. index.ts turns it on; tests leave it off and
   * call purgeExpired with a chosen time.
   */
  trashSweep?: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  app.decorate('db', opts.db);
  app.decorate('config', opts.config);
  app.decorate('storage', opts.storage ?? new DiskStorage(opts.config.uploadDir));
  const provider = opts.aiProvider !== undefined ? opts.aiProvider : createProvider(opts.config.ai);
  app.decorate('ai', provider ? guardProvider(provider, app.log) : null);
  app.decorateRequest('user', null);
  registerErrorHandler(app);

  await app.register(cookie);
  // Uploads stream to storage; the size limit is enforced while streaming (413).
  await app.register(multipart, { limits: { fileSize: opts.config.maxUploadBytes, files: 1, fields: 10, parts: 11 } });

  const publicHost = new URL(opts.config.publicUrl).host;

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // CSRF: SameSite=Lax cookies plus an Origin check on every write.
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch {
          /* malformed origin */
        }
        if (host !== req.headers.host && host !== publicHost) throw forbidden('Cross-site request refused');
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) req.user = await loadSession(app.db, token);
  });

  app.get('/health', async () => {
    await opts.health?.();
    return { status: 'ok' };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(spaceRoutes, { prefix: '/api/spaces' });
  await app.register(templateRoutes, { prefix: '/api/spaces' });
  await app.register(pageRoutes, { prefix: '/api/pages' });
  await app.register(aiPageRoutes, { prefix: '/api/pages' });
  await app.register(pageCommentRoutes, { prefix: '/api/pages' });
  await app.register(commentRoutes, { prefix: '/api/comments' });
  await app.register(pagePersonalRoutes, { prefix: '/api/pages' });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(attachmentRoutes, { prefix: '/api' });
  await app.register(linkPreviewRoutes, { prefix: '/api', fetchOptions: opts.linkPreviewFetch });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(aiRoutes, { prefix: '/api/ai' });
  await app.register(trashRoutes, { prefix: '/api' });
  await app.register(taskRoutes, { prefix: '/api' });

  if (opts.trashSweep) {
    let stop: (() => void) | null = null;
    app.addHook('onReady', async () => {
      stop = startTrashSweep(app.db, app.storage, opts.config.trashRetentionDays, (err) => app.log.warn(err));
    });
    app.addHook('onClose', async () => stop?.());
  }

  // The built web app, served from the same origin (one container in production).
  const webDist = opts.config.webDist;
  const hasWeb = !!webDist && existsSync(join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      // The web build writes .br and .gz copies of each asset; send the one
      // the browser accepts (brotli first), or the plain file if there is none.
      preCompressed: true,
      // Files in /assets have a content hash in their name, so a browser may
      // keep them for good; everything else is checked again on each load.
      // `path` is the file actually sent, so it may end in .br or .gz.
      cacheControl: false,
      setHeaders: (res, path) => {
        const hashed = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}(\.[a-z0-9]+)+$/.test(path);
        res.setHeader('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
        if (hashed) res.setHeader('vary', 'Accept-Encoding');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (hasWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      // Client-side routes: every other GET gets the app shell.
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.status(404).send({ error: 'not_found', message: 'Not found' });
  });

  return app;
}
