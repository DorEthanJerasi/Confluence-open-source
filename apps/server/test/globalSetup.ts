// Gives the server tests a real Postgres. Uses TEST_DATABASE_URL when set
// (CI, or a running compose db); otherwise starts a throwaway embedded
// Postgres in a temp directory and removes it afterwards.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    project.provide('databaseUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'stillwater-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'),
    user: 'stillwater',
    password: 'stillwater',
    port,
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
  });
  // Never wait forever: a Postgres that doesn't come up fails the run in 90s.
  const limit = <T>(what: string, p: Promise<T>) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`test db: ${what} took over 90s`)), 90_000).unref()),
    ]);
  await limit('initdb', pg.initialise());
  await limit('start', pg.start());
  await pg.createDatabase('stillwater_test');
  project.provide('databaseUrl', `postgres://stillwater:stillwater@127.0.0.1:${port}/stillwater_test`);

  return async () => {
    await Promise.race([pg.stop(), new Promise((r) => setTimeout(r, 15_000).unref())]);
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
