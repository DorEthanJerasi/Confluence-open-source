// How many spec files run at once, and where each worker's own server lives.
// Spec files can't share one database (each one empties it and expects its
// first sign-up to become admin), so global-setup.ts starts one server and
// one database per worker, and every worker talks only to its own pair.
// Default is 3: on this 4-core box (often at load 15-25 from other work) 4
// browsers starved each other into timeouts; 3 ran 32/32 in ~2.5 min once
// trace screenshots were off (playwright.config.ts). 4 was tried again on
// 2026-11-07: faster, but a test timed out at load ~23, so 3 stays the
// default. Set E2E_WORKERS to change it.
import { cpus } from 'node:os';

export const workerCount = Math.max(
  1,
  Number(process.env.E2E_WORKERS ?? Math.min(3, cpus().length)) || 1,
);

const basePort = Number(process.env.E2E_PORT ?? 3900);

/** App port for the worker with this Playwright parallel index (0-based). */
export const appPortFor = (index: number): number => basePort + index;

/** Env var global-setup.ts fills with worker <index>'s database URL. */
export const dbUrlEnvFor = (index: number): string => `E2E_DATABASE_URL_${index}`;
