// The built web app is served with cache headers that let a browser keep the
// hashed files in /assets for good, while the app shell is always re-checked
// (so a new release is picked up on the next load). Assets go out compressed
// (brotli, else gzip) from the .br/.gz copies the web build writes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { setupApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let dir: string;
const js = 'console.log("stillwater");\n'.repeat(200);
const IMMUTABLE = 'public, max-age=31536000, immutable';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'stillwater-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dir, 'assets', 'index-CbpGoIVf.js'), js);
  writeFileSync(join(dir, 'assets', 'index-CbpGoIVf.js.br'), brotliCompressSync(js));
  writeFileSync(join(dir, 'assets', 'index-CbpGoIVf.js.gz'), gzipSync(js));
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  ctx = await setupApp({ WEB_DIST: dir });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('serving the web app', () => {
  it('sends hashed assets as brotli when the browser accepts it, cached for good', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/assets/index-CbpGoIVf.js',
      headers: { 'accept-encoding': 'gzip, deflate, br' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(res.headers['vary']).toMatch(/accept-encoding/i);
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(js);
    expect(res.rawPayload.length).toBeLessThan(js.length / 4);
  });

  it('sends gzip to a browser that does not accept brotli', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/assets/index-CbpGoIVf.js',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(gunzipSync(res.rawPayload).toString()).toBe(js);
  });

  it('sends the plain file when no compression is accepted', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/assets/index-CbpGoIVf.js',
      headers: { 'accept-encoding': 'identity' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
    expect(res.body).toBe(js);
  });

  it('re-checks the app shell and other files on every load', async () => {
    for (const url of ['/', '/index.html', '/s/some-space/p/123', '/favicon.svg']) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: { 'accept-encoding': 'br, gzip' } });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe('no-cache');
      expect(res.headers['cache-control'], url).not.toMatch(/immutable|max-age=[1-9]/);
    }
  });
});
