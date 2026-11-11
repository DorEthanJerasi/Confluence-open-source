// The tests import `test` and `expect` from here instead of @playwright/test.
// Two changes: baseURL points at this worker's own server (see workers.ts and
// global-setup.ts), so spec files can run in parallel; and each worker waits
// for that server to answer /health before its first beforeAll hook or test,
// since global-setup.ts no longer waits for the servers itself (they boot
// while Playwright starts its workers and browsers).
import { test as base } from '@playwright/test';
import { appPortFor, waitForHealth } from './workers';

const serverFor = (parallelIndex: number) => process.env.E2E_BASE_URL ?? `http://127.0.0.1:${appPortFor(parallelIndex)}`;

export const test = base.extend<{}, { serverReady: void }>({
  // Worker-scoped and automatic: set up once per worker, before any hook of
  // that worker runs (resetDatabase in beforeAll needs the server's
  // migrations to have run), and before any test.
  serverReady: [
    async ({}, use, workerInfo) => {
      await waitForHealth(serverFor(workerInfo.parallelIndex));
      await use();
    },
    { scope: 'worker', auto: true, timeout: 70_000 },
  ],
  baseURL: async ({}, use, testInfo) => {
    await use(serverFor(testInfo.parallelIndex));
  },
});

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Page } from '@playwright/test';
