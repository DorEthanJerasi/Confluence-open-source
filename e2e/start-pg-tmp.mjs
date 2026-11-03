// Starts a throwaway local Postgres for running the app/tests without Docker; stop with Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'stillwater-dev-pg-'));
const pg = new EmbeddedPostgres({
  databaseDir: join(dir, 'data'),
  user: 'stillwater',
  password: 'stillwater',
  port: 5433,
  persistent: false,
  autoRehydrateSymlinks: true,
  onLog: () => {},
});
await pg.initialise();
await pg.start();
await pg.createDatabase('stillwater_dev');
console.log('PG_READY');
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
await new Promise(() => {});
