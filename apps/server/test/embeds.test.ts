// Stage 2b embed blocks in the page body (docs/done-checks/02-editor.md):
// image, file and uploaded video hold an attachment id only, never a URL or
// file bytes; a video link must be a YouTube (nocookie) or Vimeo player URL;
// a link card holds only http(s) addresses.
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

const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
const VIMEO = 'https://player.vimeo.com/video/76979871?dnt=1';

describe('video and link card blocks', () => {
  it('keeps an uploaded video, a YouTube and a Vimeo player, and a link card', async () => {
    const { ed, id } = await page();
    const card = {
      url: 'https://example.com/post',
      title: 'Harbour notes',
      description: 'Tides and boats',
      siteName: 'Example',
      imageUrl: 'https://example.com/og.png',
    };
    const doc = {
      type: 'doc',
      content: [
        { type: 'video', attrs: { attachmentId: ATTACHMENT, filename: 'tour.mp4', mime: 'video/mp4' } },
        { type: 'video', attrs: { embedUrl: YT } },
        { type: 'video', attrs: { embedUrl: VIMEO } },
        { type: 'linkPreview', attrs: card },
        { type: 'linkPreview', attrs: { url: 'http://10.0.0.1/' } },
      ],
    };
    expect((await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc })).status).toBe(200);
    const [up, yt, vm, rich, plain] = (await ed.client.get(`/api/pages/${id}`)).body.page.doc.content;
    expect(up.attrs).toMatchObject({ attachmentId: ATTACHMENT, embedUrl: null, filename: 'tour.mp4' });
    expect(yt.attrs).toMatchObject({ attachmentId: null, embedUrl: YT });
    expect(vm.attrs.embedUrl).toBe(VIMEO);
    expect(rich.attrs).toMatchObject(card);
    expect(plain.attrs).toMatchObject({ url: 'http://10.0.0.1/', title: '', imageUrl: null });
  });

  it('puts the video name and the card title and address into the page text', () => {
    const text = docToText({
      type: 'doc',
      content: [
        { type: 'video', attrs: { attachmentId: ATTACHMENT, filename: 'tour.mp4' } },
        { type: 'video', attrs: { embedUrl: YT } },
        { type: 'linkPreview', attrs: { url: 'https://example.com/post', title: 'Harbour notes' } },
      ],
    });
    expect(text).toBe('tour.mp4\nHarbour notes https://example.com/post');
  });

  it.each([
    ['a video from another site', { type: 'video', attrs: { embedUrl: 'https://evil.example/embed/x' } }],
    ['a plain YouTube page instead of the nocookie player', { type: 'video', attrs: { embedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }],
    ['a player URL with extra parts', { type: 'video', attrs: { embedUrl: `${YT}?autoplay=1` } }],
    ['a javascript: player', { type: 'video', attrs: { embedUrl: 'javascript:alert(1)' } }],
    ['a video with no source', { type: 'video', attrs: {} }],
    ['a video with both an upload and a link', { type: 'video', attrs: { attachmentId: ATTACHMENT, embedUrl: YT } }],
    ['a video holding a URL as its attachment', { type: 'video', attrs: { attachmentId: 'https://example.com/a.mp4' } }],
    ['a link card with no address', { type: 'linkPreview', attrs: { title: 'x' } }],
    ['a javascript: link card', { type: 'linkPreview', attrs: { url: 'javascript:alert(1)' } }],
    ['a link card with a data: picture', { type: 'linkPreview', attrs: { url: 'https://a.example/', imageUrl: 'data:image/png;base64,AA' } }],
    ['a link card with a file: picture', { type: 'linkPreview', attrs: { url: 'https://a.example/', imageUrl: 'file:///etc/passwd' } }],
  ])('rejects %s with 400 and leaves the page alone', async (_name, block) => {
    const { ed, id } = await page();
    const res = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: { type: 'doc', content: [block] } });
    expect(res.status).toBe(400);
    expect((await ed.client.get(`/api/pages/${id}`)).body.page.version).toBe(1);
  });
});
