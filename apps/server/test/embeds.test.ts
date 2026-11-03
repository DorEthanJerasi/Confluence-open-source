// Stage 2b image and file blocks in the page body (docs/done-checks/02-editor.md):
// they hold an attachment id only, never a URL or file bytes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupApp, signup, type TestCtx } from './helpers.js';
import { docToText } from '../src/pages/docText.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const ATTACHMENT = '22222222-2222-4222-8222-222222222222';

async function page() {
  const ed = await signup(ctx.app, 'Ada');
  await ed.client.post('/api/spaces', { key: 'docs', name: 'Docs' });
  const id = (await ed.client.post('/api/spaces/docs/pages', { title: 'P' })).body.page.id as string;
  return { ed, id };
}

describe('image and file blocks', () => {
  it('keeps only the attachment id and plain attrs, dropping any URL', async () => {
    const { ed, id } = await page();
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { attachmentId: ATTACHMENT, caption: 'Bay', src: 'https://example.com/x.png' } },
        { type: 'file', attrs: { attachmentId: ATTACHMENT, filename: 'a.zip', size: 10, href: 'https://example.com/a.zip' } },
      ],
    };
    expect((await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc })).status).toBe(200);
    const [img, file] = (await ed.client.get(`/api/pages/${id}`)).body.page.doc.content;
    expect(Object.keys(img.attrs).sort()).toEqual(['alt', 'attachmentId', 'caption', 'id']);
    expect(img.attrs).toMatchObject({ attachmentId: ATTACHMENT, caption: 'Bay' });
    expect(Object.keys(file.attrs).sort()).toEqual(['attachmentId', 'filename', 'id', 'mime', 'size']);
    expect(file.attrs).toMatchObject({ attachmentId: ATTACHMENT, filename: 'a.zip', size: 10 });
  });

  it('puts the caption and the file name into the page text for search', () => {
    const text = docToText({
      type: 'doc',
      content: [
        { type: 'image', attrs: { attachmentId: ATTACHMENT, caption: 'Harbour at dawn' } },
        { type: 'file', attrs: { attachmentId: ATTACHMENT, filename: 'tides.pdf', size: 1 } },
      ],
    });
    expect(text).toBe('Harbour at dawn\ntides.pdf');
  });

  it.each([
    ['an image pointing at a URL', { type: 'image', attrs: { attachmentId: 'https://example.com/x.png' } }],
    ['an image holding bytes', { type: 'image', attrs: { attachmentId: 'data:image/png;base64,AAAA' } }],
    ['a file with a made-up id', { type: 'file', attrs: { attachmentId: '../../etc/passwd', filename: 'x' } }],
    ['a file with a number for an id', { type: 'file', attrs: { attachmentId: 42, filename: 'x' } }],
  ])('rejects %s with 400 and leaves the page alone', async (_name, block) => {
    const { ed, id } = await page();
    const res = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: { type: 'doc', content: [block] } });
    expect(res.status).toBe(400);
    expect((await ed.client.get(`/api/pages/${id}`)).body.page.version).toBe(1);
  });
});
