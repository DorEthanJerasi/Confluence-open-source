import { inject } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp, type BuildOptions } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { loadConfig } from '../src/env.js';

export interface TestCtx {
  app: FastifyInstance;
  close: () => Promise<void>;
  reset: () => Promise<void>;
  pool: Pool;
  db: Db;
}

export async function setupApp(
  env: Record<string, string> = {},
  extra: Pick<BuildOptions, 'linkPreviewFetch' | 'aiProvider'> = {},
): Promise<TestCtx> {
  const databaseUrl = inject('databaseUrl');
  await runMigrations(databaseUrl);
  const { pool, db } = createDb(databaseUrl);
  const config = loadConfig({ DATABASE_URL: databaseUrl, PUBLIC_URL: 'http://wiki.test', WEB_DIST: '', ...env });
  const app = await buildApp({ db, config, ...extra });
  return {
    app,
    pool,
    db,
    reset: async () => {
      await pool.query('truncate users, sessions, spaces, space_members, pages cascade');
    },
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** A tiny cookie-carrying client over app.inject(). */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async req(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const set = res.cookies.find((c) => c.name === 'stillwater_session');
    if (set) this.cookie = set.value ? `stillwater_session=${set.value}` : '';
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* not json */
    }
    return { status: res.statusCode, body: json, raw: res };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  put = (url: string, body?: unknown) => this.req('PUT', url, body ?? {});
  patch = (url: string, body?: unknown) => this.req('PATCH', url, body ?? {});
  del = (url: string) => this.req('DELETE', url);
}

export async function signup(app: FastifyInstance, name: string, email = `${name.toLowerCase()}@example.com`) {
  const c = new Client(app);
  const res = await c.post('/api/auth/signup', { email, name, password: 'correct horse battery' });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client: c, user: res.body.user as { id: string; role: string } };
}
