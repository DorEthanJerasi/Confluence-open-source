// Starts Stillwater without Docker, in the foreground: a local Postgres
// (embedded-postgres, data kept in .local-data/ so it survives restarts)
// and the built server listening on HOST:PORT (default 127.0.0.1:3000).
// If DATABASE_URL is already set, that database is used and no local
// Postgres is started. Stop with Ctrl+C. Used by install.sh.
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.LOCAL_DATA_DIR || join(repoRoot, '.local-data');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

const serverEntry = join(repoRoot, 'apps/server/dist/index.js');
if (!existsSync(serverEntry) || !existsSync(join(repoRoot, 'apps/web/dist/index.html'))) {
  console.error('local-start: build missing, run `npm run build` first (install.sh does this)');
  process.exit(1);
}

let pg = null;
let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pgDir = join(dataRoot, 'pg');
  const pgPort = Number(process.env.PG_PORT) || (await freePort());
  mkdirSync(dataRoot, { recursive: true });
  pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: 'stillwater',
    password: 'stillwater',
    port: pgPort,
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
  });
  const fresh = !existsSync(join(pgDir, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase('stillwater');
  databaseUrl = `postgres://stillwater:stillwater@127.0.0.1:${pgPort}/stillwater`;
  console.log(`local-start: Postgres ready on 127.0.0.1:${pgPort} (data in ${pgDir})`);
}

const server = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    HOST: host,
    PORT: String(port),
    PUBLIC_URL: process.env.PUBLIC_URL || `http://${host}:${port}`,
    UPLOAD_DIR: process.env.UPLOAD_DIR || join(dataRoot, 'uploads'),
  },
  stdio: 'inherit',
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  }
  if (pg) await pg.stop().catch(() => {});
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
server.on('exit', (code) => stop(code ?? 1));
