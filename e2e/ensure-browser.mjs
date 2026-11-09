#!/usr/bin/env node
// Installs Playwright's Chromium only when it isn't already there, so the
// e2e run never reaches for the network when a browser is installed.
//
// The quick check reads playwright-core's browsers.json and looks for the
// INSTALLATION_COMPLETE marker Playwright writes into each finished browser
// folder (PLAYWRIGHT_BROWSERS_PATH=0 puts them in .local-browsers). That
// takes a few milliseconds; importing @playwright/test to ask it the same
// question took ~4 s of every e2e run on this busy box (done-check 10).
// If anything about that layout is unexpected, it falls back to
// `playwright install chromium`, which is a no-op when the browser is there.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

function installed() {
  try {
    const require = createRequire(import.meta.url);
    const core = dirname(require.resolve('playwright-core/package.json'));
    const { browsers } = JSON.parse(readFileSync(join(core, 'browsers.json'), 'utf8'));
    // Headless runs use the headless shell; `playwright install chromium` fetches both.
    const want = browsers.filter((b) => b.name === 'chromium' || b.name === 'chromium-headless-shell');
    if (want.length !== 2) return false;
    return want.every((b) =>
      existsSync(join(core, '.local-browsers', `${b.name.replace(/-/g, '_')}-${b.revision}`, 'INSTALLATION_COMPLETE')),
    );
  } catch {
    return false;
  }
}

if (installed()) {
  console.log('e2e: Chromium already installed, skipped download');
} else {
  const r = spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}
