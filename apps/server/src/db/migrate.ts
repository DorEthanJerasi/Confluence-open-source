import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { requireDatabaseUrl } from '../env.js';

export async function runMigrations(databaseUrl: string = requireDatabaseUrl()): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('migrations: done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('migrations: failed', err);
      process.exit(1);
    });
}
