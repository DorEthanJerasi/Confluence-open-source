// Stage 2b uploads (docs/done-checks/02-editor.md): POST /api/pages/:id/attachments
// and GET /api/attachments/:id, with the space permission rules.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';
import { cleanFilename, contentDisposition, normalizeMime } from '../src/files/attachments.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'stillwater-uploads-'));
let ctx: TestCtx;
let w: Awaited<ReturnType<typeof world>>;
// Signups are rate-limited per address, so the users are made once for the file.
beforeAll(async () => {
  ctx = await setupApp({ UPLOAD_DIR: uploadDir, MAX_UPLOAD_MB: '1' });
  await ctx.reset();
  w = await world();
});
afterAll(async () => {
  await ctx.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(filename: string, mime: string, data: Buffer) {
  const boundary = '----stillwater' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(app: FastifyInstance, c: Client, pageId: string, filename: string, mime: string, data: Buffer) {
  const body = multipart(filename, mime, data);
  const res = await app.inject({
    method: 'POST',
    url: `/api/pages/${pageId}/attachments`,
    headers: { 'content-type': body.contentType, ...(c.cookie ? { cookie: c.cookie } : {}) },
    payload: body.payload,
  });
  return { status: res.statusCode, body: res.json() };
}

/** Ada (admin) makes a restricted space with one page; Bob is an editor member,
 *  Dee a viewer member, Cy is signed in but not a member. */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const bob = await signup(ctx.app, 'Bob');
  const cy = await signup(ctx.app, 'Cy');
  const dee = await signup(ctx.app, 'Dee');
  expect((await ada.client.post('/api/spaces', { key: 'secret', name: 'Secret', visibility: 'restricted' })).status).toBe(201);
  await ada.client.put(`/api/spaces/secret/members/${bob.user.id}`, { role: 'editor' });
  await ada.client.put(`/api/spaces/secret/members/${dee.user.id}`, { role: 'viewer' });
  const page = await ada.client.post('/api/spaces/secret/pages', { title: 'Plans', parentId: null });
  expect(page.status).toBe(201);
  return { ada, bob, cy, dee, pageId: page.body.page.id as string };
}

const storedFiles = () => readdirSync(uploadDir);

describe('attachments', () => {
  it('a member uploads a file and members can fetch it back, byte for byte', async () => {
    const { bob, dee, pageId } = w;
    const res = await upload(ctx.app, bob.client, pageId, 'dot.png', 'image/png', PNG);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), filename: 'dot.png', mime: 'image/png', size: PNG.length });
    expect(storedFiles()).toContain(res.body.id);

    for (const reader of [bob, dee]) {
      const got = await reader.client.get(`/api/attachments/${res.body.id}`);
      expect(got.status).toBe(200);
      expect(got.raw.rawPayload.equals(PNG)).toBe(true);
      expect(got.raw.headers['content-type']).toBe('image/png');
      expect(got.raw.headers['content-length']).toBe(String(PNG.length));
      expect(got.raw.headers['x-content-type-options']).toBe('nosniff');
      expect(got.raw.headers['content-disposition']).toMatch(/^inline;/);
    }
  });

  it('a non-member of a restricted space gets 404, for fetch and upload; signed-out too', async () => {
    const { bob, cy, pageId } = w;
    const { body } = await upload(ctx.app, bob.client, pageId, 'dot.png', 'image/png', PNG);
    expect((await cy.client.get(`/api/attachments/${body.id}`)).status).toBe(404);
    expect((await new Client(ctx.app).get(`/api/attachments/${body.id}`)).status).toBe(404);
    expect((await upload(ctx.app, cy.client, pageId, 'x.png', 'image/png', PNG)).status).toBe(404);
    // Unknown and malformed ids look the same as forbidden ones.
    expect((await bob.client.get('/api/attachments/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await bob.client.get('/api/attachments/not-an-id')).status).toBe(404);
  });

  it("a viewer's upload gets 403 and nothing is stored", async () => {
    const { dee, pageId } = w;
    const before = storedFiles().length;
    const res = await upload(ctx.app, dee.client, pageId, 'dot.png', 'image/png', PNG);
    expect(res.status).toBe(403);
    expect(storedFiles().length).toBe(before);
  });

  it('a file over MAX_UPLOAD_MB gets 413 and nothing is stored', async () => {
    const { bob, pageId } = w;
    const before = storedFiles().length;
    const big = Buffer.alloc(1024 * 1024 + 10, 7);
    const res = await upload(ctx.app, bob.client, pageId, 'big.bin', 'application/octet-stream', big);
    expect(res.status).toBe(413);
    expect(storedFiles().length).toBe(before);
    // Exactly at the limit is fine.
    const ok = await upload(ctx.app, bob.client, pageId, 'ok.bin', 'application/octet-stream', Buffer.alloc(1024 * 1024, 7));
    expect(ok.status).toBe(201);
  });

  it('documents download; SVG and HTML are never served inline', async () => {
    const { bob, pageId } = w;
    const cases = [
      ['report.pdf', 'application/pdf'],
      ['logo.svg', 'image/svg+xml'],
      ['page.html', 'text/html'],
      ['weird', 'not a mime'],
    ] as const;
    for (const [name, mime] of cases) {
      const { status, body } = await upload(ctx.app, bob.client, pageId, name, mime, Buffer.from('<svg onload="alert(1)"/>'));
      expect(status).toBe(201);
      const got = await bob.client.get(`/api/attachments/${body.id}`);
      expect(got.status).toBe(200);
      expect(got.raw.headers['content-disposition']).toMatch(/^attachment;/);
      expect(got.raw.headers['x-content-type-options']).toBe('nosniff');
      expect(got.raw.headers['content-type']).toBe(mime === 'not a mime' ? 'application/octet-stream' : mime);
    }
  });

  it('video files play inline', async () => {
    const { bob, pageId } = w;
    const { body } = await upload(ctx.app, bob.client, pageId, 'clip.webm', 'video/webm', Buffer.from('webm'));
    const got = await bob.client.get(`/api/attachments/${body.id}`);
    expect(got.raw.headers['content-type']).toBe('video/webm');
    expect(got.raw.headers['content-disposition']).toMatch(/^inline;/);
  });

  it('refuses a request that is not multipart, or has no file', async () => {
    const { bob, pageId } = w;
    expect((await bob.client.post(`/api/pages/${pageId}/attachments`, { file: 'nope' })).status).toBe(400);
  });
});

describe('default limit', () => {
  it('accepts a file larger than the 5 MB JSON body limit when MAX_UPLOAD_MB allows it', async () => {
    const big = await setupApp({ UPLOAD_DIR: uploadDir }); // MAX_UPLOAD_MB unset: 25
    try {
      expect(big.app.config.maxUploadBytes).toBe(25 * 1024 * 1024);
      const data = Buffer.alloc(6 * 1024 * 1024, 1);
      const res = await upload(big.app, w.bob.client, w.pageId, 'six.bin', 'application/octet-stream', data);
      expect(res.status).toBe(201);
      expect(res.body.size).toBe(data.length);
    } finally {
      await big.close();
    }
  });
});

describe('attachment helpers', () => {
  it('cleans names and mime types', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('C:\\Users\\a\\b.txt')).toBe('b.txt');
    expect(cleanFilename('bad\r\n"name".txt')).toBe('badname.txt');
    expect(cleanFilename('')).toBe('file');
    expect(normalizeMime('Image/PNG; charset=binary')).toBe('image/png');
    expect(normalizeMime('<script>')).toBe('application/octet-stream');
    expect(contentDisposition('attachment', 'Été plan.pdf')).toBe(
      `attachment; filename="_t_ plan.pdf"; filename*=UTF-8''%C3%89t%C3%A9%20plan.pdf`,
    );
  });
});
