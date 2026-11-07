import { defineConfig } from '@playwright/test';
import { workerCount } from './workers';

// Spec files run in parallel, one per worker; each worker has its own server
// and database (global-setup.ts), so they never see each other's data. Tests
// inside a file stay in order (they are describe.serial and build on each other).
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: workerCount,
  retries: 0,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  use: {
    // baseURL is set per worker in fixtures.ts.
    // No trace by default: recording one means a DOM snapshot on every action
    // of every test, passing or not, and on this busy 4-core box that alone
    // made the suite ~30% slower (161s -> 111s on 2026-11-07, at a higher load
    // for the faster run). A failed test still leaves a screenshot. To debug a
    // failure, rerun with E2E_TRACE=1 for the full trace (actions, DOM, network),
    // and E2E_TRACE_SCREENSHOTS=1 to add the screencast.
    trace:
      process.env.E2E_TRACE === '1'
        ? { mode: 'retain-on-failure', screenshots: process.env.E2E_TRACE_SCREENSHOTS === '1', snapshots: true }
        : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
