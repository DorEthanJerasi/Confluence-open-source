import Fastify from 'fastify';
import { Pool } from 'pg';
import { env, requireDatabaseUrl } from './env.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  await runMigrations();

  const pool = new Pool({ connectionString: requireDatabaseUrl() });
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    await pool.query('select 1');
    return { status: 'ok' };
  });

  const close = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  await app.listen({ host: '0.0.0.0', port: env.port });
}

main().catch((err) => {
  console.error('server: failed to start', err);
  process.exit(1);
});
