// Builds the Fastify app. index.ts starts it; tests use app.inject().
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { Config } from './env.js';
import type { Db } from './db/client.js';
import { loadSession, SESSION_COOKIE } from './auth/session.js';
import './auth/guard.js';
import { forbidden, registerErrorHandler } from './http.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { spaceRoutes } from './routes/spaces.js';
import { pageRoutes } from './routes/pages.js';

export interface BuildOptions {
  db: Db;
  config: Config;
  /** Extra health check, e.g. a DB round trip. */
  health?: () => Promise<void>;
  logger?: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  app.decorate('db', opts.db);
  app.decorate('config', opts.config);
  app.decorateRequest('user', null);
  registerErrorHandler(app);

  await app.register(cookie);

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
  await app.register(pageRoutes, { prefix: '/api/pages' });

  // The built web app, served from the same origin (one container in production).
  const webDist = opts.config.webDist;
  const hasWeb = !!webDist && existsSync(join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
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
