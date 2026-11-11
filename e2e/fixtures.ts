// The tests import `test` and `expect` from here instead of @playwright/test.
// Three changes: baseURL points at this worker's own server (see workers.ts and
// global-setup.ts), so spec files can run in parallel; each worker waits
// for that server to answer /health before its first beforeAll hook or test,
// since global-setup.ts no longer waits for the servers itself (they boot
// while Playwright starts its workers and browsers); and a failed test's page
// is screenshotted here, only on failure (see `page` below).
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
  // A failed test leaves a screenshot of its page, taken here, only when it
  // failed. Playwright's own screenshot: 'only-on-failure' (off in
  // playwright.config.ts) shoots every page of every test as its browser
  // context closes, passing or not, and throws the picture away if the test
  // passed; on this busy box that took 4-11 s in some tests (item #145,
  // docs/done-checks/12-tasks.md), about 40 s of test time per run.
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
    const path = testInfo.outputPath('test-failed-1.png');
    try {
      await page.screenshot({ path, timeout: 5_000 });
      testInfo.attachments.push({ name: 'screenshot', path, contentType: 'image/png' });
    } catch {
      // The page may be gone or stuck; the error itself is what matters.
    }
  },
});

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Page } from '@playwright/test';
