// Boots a real server for Playwright to drive: a throwaway embedded Postgres
// (built and migrated the same way the compose stack does on first start),
// then the built apps/server/dist/index.js serving the built web app.
// Returns a teardown closure, which Playwright runs after the whole run.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';

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
  await pg.createDatabase('stillwater_e2e');
  const databaseUrl = `postgres://stillwater:stillwater@127.0.0.1:${pgPort}/stillwater_e2e`;

  const appPort = Number(process.env.E2E_PORT ?? 3900);
  const server = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(appPort),
      PUBLIC_URL: `http://127.0.0.1:${appPort}`,
      ALLOW_SIGNUP: 'true',
    },
    stdio: 'inherit',
  });

  const teardown = async () => {
    server.kill();
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(`http://127.0.0.1:${appPort}/health`);
  } catch (err) {
    await teardown();
    throw err;
  }

  return teardown;
}
