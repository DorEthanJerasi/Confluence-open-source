// The built web app is served with cache headers that let a browser keep the
// hashed files in /assets for good, while the app shell is always re-checked
// (so a new release is picked up on the next load).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stillwater-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dir, 'assets', 'index-CbpGoIVf.js'), 'console.log(1)');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  ctx = await setupApp({ WEB_DIST: dir });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('serving the web app', () => {
  it('lets browsers keep hashed assets', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/assets/index-CbpGoIVf.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('re-checks the app shell and other files on every load', async () => {
    for (const url of ['/', '/s/some-space/p/123', '/favicon.svg']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe('no-cache');
    }
  });
});
