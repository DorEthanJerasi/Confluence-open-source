// Boots a real server for Playwright to drive: a throwaway embedded Postgres
// (built and migrated the same way the compose stack does on first start),
// then one built apps/server/dist/index.js per test worker, each on its own
// database and port, serving the built web app.
// Returns a teardown closure, which Playwright runs after the whole run.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { workerCount, appPortFor, dbUrlEnvFor } from './workers';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

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

async function waitForHealth(url: string, tries = 90): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`e2e: server never became healthy at ${url}`);
}

export default async function globalSetup() {
  const serverEntry = join(repoRoot, 'apps/server/dist/index.js');
  const webIndex = join(repoRoot, 'apps/web/dist/index.html');
  if (!existsSync(serverEntry) || !existsSync(webIndex)) {
    throw new Error('e2e: build missing — run `npm run build` before the e2e tests (test:e2e does this for you)');
  }

  const dir = mkdtempSync(join(tmpdir(), 'stillwater-e2e-pg-'));
  const pgPort = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'),
    user: 'stillwater',
    password: 'stillwater',
    port: pgPort,
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  // One database and one server per worker, so spec files can run in
  // parallel without emptying each other's data (see workers.ts).
  const servers: ChildProcess[] = [];
  const teardown = async () => {
    // Let each server close its pool before Postgres goes away, or it logs a
    // "terminating connection" error dump on the way out.
    await Promise.all(
      servers.map(async (server) => {
        if (server.exitCode !== null || server.signalCode !== null) return;
        const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
        server.kill();
        await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      }),
    );
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    // One at a time: Postgres refuses CREATE DATABASE while template1 is busy.
    for (let i = 0; i < workerCount; i++) await pg.createDatabase(`stillwater_e2e_${i}`);
    await Promise.all(
      Array.from({ length: workerCount }, async (_, i) => {
        const dbName = `stillwater_e2e_${i}`;
        const databaseUrl = `postgres://stillwater:stillwater@127.0.0.1:${pgPort}/${dbName}`;
        // Test workers inherit this, so each spec file can empty its worker's tables (reset-db.ts).
        process.env[dbUrlEnvFor(i)] = databaseUrl;
        const appPort = appPortFor(i);
        const server = spawn(process.execPath, [serverEntry], {
          cwd: repoRoot,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            PORT: String(appPort),
            PUBLIC_URL: `http://127.0.0.1:${appPort}`,
            ALLOW_SIGNUP: 'true',
            // Uploads go in the same temp dir, removed in teardown.
            UPLOAD_DIR: join(dir, `uploads-${i}`),
            // The AI suite runs against the deterministic stub, never the network.
            AI_PROVIDER: 'stub',
            ANTHROPIC_API_KEY: '',
          },
          stdio: 'inherit',
        });
        servers.push(server);
        await waitForHealth(`http://127.0.0.1:${appPort}/health`);
      }),
    );
  } catch (err) {
    await teardown();
    throw err;
  }

  return teardown;
}
