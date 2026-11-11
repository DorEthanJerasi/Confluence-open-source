// Boots a real server for Playwright to drive: a throwaway embedded Postgres
// (built and migrated the same way the compose stack does on first start),
// then one built apps/server/dist/index.js per test worker, each on its own
// database and port, serving the built web app.
// Returns a teardown closure, which Playwright runs after the whole run.
import { mkdtempSync, rmSync, existsSync, cpSync, renameSync, readFileSync } from 'node:fs';
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

function embeddedPgVersion(): string {
  try {
    const pkg = join(repoRoot, 'node_modules/embedded-postgres/package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version.replace(/[^\w.-]/g, '_');
  } catch {
    return 'unknown';
  }
}

export default async function globalSetup() {
  const serverEntry = join(repoRoot, 'apps/server/dist/index.js');
  const webIndex = join(repoRoot, 'apps/web/dist/index.html');
  if (!existsSync(serverEntry) || !existsSync(webIndex)) {
    throw new Error('e2e: build missing — run `npm run build` before the e2e tests (test:e2e does this for you)');
  }

  const t0 = Date.now();
  const lap: string[] = [];
  let tl = t0;
  const mark = (name: string) => {
    const now = Date.now();
    lap.push(`${name} ${((now - tl) / 1000).toFixed(1)}s`);
    tl = now;
  };
  const dir = mkdtempSync(join(tmpdir(), 'stillwater-e2e-pg-'));
  const dataDir = join(dir, 'data');
  const pgPort = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'stillwater',
    password: 'stillwater',
    port: pgPort,
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    // A throwaway cluster that is deleted after the run: nothing needs to
    // survive a crash, so skip the disk syncs on every commit (each autosave
    // is a commit). Test set-up only; the compose stack's Postgres is untouched.
    postgresFlags: ['-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'],
  });
  // initdb costs ~3 s of CPU on this busy box and makes the same empty
  // cluster every time, so the first run keeps a copy in the temp dir and
  // later runs copy that instead (~0.3 s). The copy is keyed by the
  // embedded-postgres version, and is renamed into place only when complete,
  // so an interrupted run never leaves half a cluster behind.
  const cache = join(tmpdir(), `stillwater-e2e-pgcluster-${embeddedPgVersion()}`);
  if (existsSync(join(cache, 'PG_VERSION'))) {
    cpSync(cache, dataDir, { recursive: true });
    mark('copy cluster');
  } else {
    await pg.initialise();
    mark('initdb');
    let part = '';
    try {
      part = mkdtempSync(`${cache}.part-`);
      cpSync(dataDir, part, { recursive: true });
      renameSync(part, cache);
    } catch {
      // another run got there first, or the temp dir is read-only: fine either way
      if (part) rmSync(part, { recursive: true, force: true });
    }
  }
  await pg.start();
  mark('postgres start');
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
    mark('create databases');
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
            // One log line per request costs CPU on a busy box and buries failures.
            // Set E2E_SERVER_LOG=info to see every request again.
            LOG_LEVEL: process.env.E2E_SERVER_LOG ?? 'warn',
            // Uploads go in the same temp dir, removed in teardown.
            UPLOAD_DIR: join(dir, `uploads-${i}`),
            // The AI suite runs against the deterministic stub, never the network.
            AI_PROVIDER: 'stub',
            ANTHROPIC_API_KEY: '',
            // Cheap argon2 settings for the many test sign-ups and logins
            // (apps/server/src/auth/password.ts). Set only here, for these
            // throwaway servers; compose and real installs never set it.
            E2E_FAST_PASSWORD_HASH: '1',
          },
          stdio: 'inherit',
        });
        servers.push(server);
        await waitForHealth(`http://127.0.0.1:${appPort}/health`);
      }),
    );
    mark('servers healthy');
    console.log(`e2e: set-up took ${((Date.now() - t0) / 1000).toFixed(1)}s (${lap.join(', ')})`);
  } catch (err) {
    await teardown();
    throw err;
  }

  return teardown;
}
