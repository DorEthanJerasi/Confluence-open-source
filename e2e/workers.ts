// How many spec files run at once, and where each worker's own server lives.
// Spec files can't share one database (each one empties it and expects its
// first sign-up to become admin), so global-setup.ts starts one server and
// one database per worker, and every worker talks only to its own pair.
// Default is one worker per core, at most 4. Measured on this 4-core box on
// 2026-11-10 (item #123, docs/done-checks/10-e2e-speed.md, step 5): six full
// runs in the order 3, 2, 4, 4, 2, 3 at load 11-24. Means: 2 workers 213 s,
// 3 workers 150 s (one run had a failure), 4 workers 146 s (both passed).
// Fewer workers under heavy load did not help: 2 workers took 256 s at load
// ~20. Set E2E_WORKERS to change it.
import { cpus } from 'node:os';

export const workerCount = Math.max(
  1,
  Number(process.env.E2E_WORKERS ?? Math.min(4, cpus().length)) || 1,
);

const basePort = Number(process.env.E2E_PORT ?? 3900);

/** App port for the worker with this Playwright parallel index (0-based). */
export const appPortFor = (index: number): number => basePort + index;

/** Env var global-setup.ts fills with worker <index>'s database URL. */
export const dbUrlEnvFor = (index: number): string => `E2E_DATABASE_URL_${index}`;
