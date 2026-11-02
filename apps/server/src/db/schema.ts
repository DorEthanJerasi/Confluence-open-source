// Placeholder schema for the self-host skeleton. The coder replaces/extends
// this with the real tables from ARCHITECTURE.md §4. This table only proves
// that migrations run on server start against a real Postgres.
import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const instanceMeta = pgTable('instance_meta', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
