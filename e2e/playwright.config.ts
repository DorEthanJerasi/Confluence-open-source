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
    // A failed test keeps its trace (actions, DOM snapshots, network), but
    // without the screencast: recording screenshots of every passing test cost
    // a lot of CPU on this busy box. Set E2E_TRACE_SCREENSHOTS=1 to get them back.
    trace: { mode: 'retain-on-failure', screenshots: process.env.E2E_TRACE_SCREENSHOTS === '1', snapshots: true },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
