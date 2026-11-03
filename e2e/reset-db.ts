// Empties every app table so each spec file starts from a blank instance:
// no users (so its first sign-up becomes admin again), no spaces, no pages.
// global-setup.ts puts the throwaway database's URL in E2E_DATABASE_URL.
// Drizzle's migration record lives in the "drizzle" schema, so the schema
// itself stays migrated; only rows in "public" are removed.
import pg from 'pg';

export async function resetDatabase(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('e2e: E2E_DATABASE_URL is not set (global-setup.ts sets it)');
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
