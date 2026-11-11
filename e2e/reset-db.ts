// Empties every app table so each spec file starts from a blank instance:
// no users (so its first sign-up becomes admin again), no spaces, no pages.
// Each worker has its own database (global-setup.ts puts worker <n>'s URL in
// E2E_DATABASE_URL_<n>), so this only touches the calling worker's data.
// Drizzle's migration record lives in the "drizzle" schema, so the schema
// itself stays migrated; only rows in "public" are removed.
// It first waits for this worker's server to answer /health: the servers
// migrate their databases as they boot, and a spec file's beforeAll can run
// before fixtures.ts's serverReady has waited for them.
import pg from 'pg';
import { appPortFor, dbUrlEnvFor, waitForHealth } from './workers';
import { forgetSessions } from './login';

export async function resetDatabase(): Promise<void> {
  // The sessions table is emptied too, so the logins login.ts saved are void.
  forgetSessions();
  const index = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  await waitForHealth(process.env.E2E_BASE_URL ?? `http://127.0.0.1:${appPortFor(index)}`);
  const url = process.env[dbUrlEnvFor(index)];
  if (!url) throw new Error(`e2e: ${dbUrlEnvFor(index)} is not set (global-setup.ts sets it)`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length === 0) return;
    const list = rows.map((r) => `"public"."${r.tablename.replace(/"/g, '""')}"`).join(', ');
    await client.query(`truncate ${list} restart identity cascade`);
  } finally {
    await client.end();
  }
}
