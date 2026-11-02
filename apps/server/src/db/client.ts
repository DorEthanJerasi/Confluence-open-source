import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(databaseUrl: string): { pool: Pool; db: Db } {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
