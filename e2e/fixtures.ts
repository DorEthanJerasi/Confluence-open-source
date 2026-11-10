// The tests import `test` and `expect` from here instead of @playwright/test:
// the only change is that baseURL points at this worker's own server
// (see workers.ts and global-setup.ts), so spec files can run in parallel.
import { test as base } from '@playwright/test';
import { appPortFor } from './workers';

export const test = base.extend({
  baseURL: async ({}, use, testInfo) => {
    await use(process.env.E2E_BASE_URL ?? `http://127.0.0.1:${appPortFor(testInfo.parallelIndex)}`);
  },
});

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Page } from '@playwright/test';
