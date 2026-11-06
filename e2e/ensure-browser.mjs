#!/usr/bin/env node
// Installs Playwright's Chromium only when it isn't already there, so the
// e2e run never reaches for the network when a browser is installed.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
let path = '';
try {
  path = chromium.executablePath();
} catch {
  path = '';
}
if (path && existsSync(path)) {
  console.log('e2e: Chromium already installed, skipped download');
} else {
  const r = spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}
