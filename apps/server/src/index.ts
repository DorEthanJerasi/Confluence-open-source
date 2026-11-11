import { aiSetupNote, env, requireDatabaseUrl } from './env.js';
import { runMigrations } from './db/migrate.js';
import { createDb } from './db/client.js';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth/session.js';
import { usingE2eFastHash } from './auth/password.js';

async function main(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  await runMigrations(databaseUrl);

  const { pool, db } = createDb(databaseUrl);
  const app = await buildApp({
    db,
    config: env,
    // LOG_LEVEL (default info) lets the e2e run keep its servers quiet: 'warn' skips the per-request lines.
    logger: { level: process.env.LOG_LEVEL?.trim() || 'info' },
    // Trash older than TRASH_RETENTION_DAYS is deleted for good: on start, then hourly.
    trashSweep: true,
    health: async () => {
      await pool.query('select 1');
    },
  });

  const aiNote = aiSetupNote();
  if (aiNote) app.log.warn(aiNote);
  app.log.info(`AI features: ${app.ai ? 'on' : 'off'}`);
  if (usingE2eFastHash) {
    app.log.warn('E2E_FAST_PASSWORD_HASH=1: weak password hashing for the e2e tests. Never set this on a real install.');
  }

  const purge = setInterval(() => purgeExpiredSessions(db).catch((err) => app.log.warn(err)), 6 * 60 * 60 * 1000);
  purge.unref();

  const close = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  // HOST defaults to all interfaces (needed inside the container); install.sh sets 127.0.0.1.
  await app.listen({ host: process.env.HOST?.trim() || '0.0.0.0', port: env.port });
}

main().catch((err) => {
  console.error('server: failed to start', err);
  process.exit(1);
});
