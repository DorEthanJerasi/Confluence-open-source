// Export to Markdown and PDF, server side (docs/done-checks/16-export.md,
// "16a — Server"): the Markdown text, single file or zip, sub-pages in
// sidebar order, trash, permissions, no outside fetch, the PDF, the limits,
// read-only, and the headers. Real Postgres.
import http from 'node:http';
import https from 'node:https';
import { inflateSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'stillwater-export-'));
let ctx: TestCtx;
let small: TestCtx;
let w: Awaited<ReturnType<typeof world>>;
/** Calls the link-preview fetcher would make; export must make none. */
let fetcherCalls = 0;

beforeAll(async () => {
  const fetchOptions = {
    resolve: async () => {
      fetcherCalls++;
      throw new Error('export must not fetch anything');
    },
  };
  ctx = await setupApp({ UPLOAD_DIR: uploadDir, AI_PROVIDER: 'stub' }, { exportOptions: { pdfCompress: false }, linkPreviewFetch: fetchOptions });
  small = await setupApp({ UPLOAD_DIR: uploadDir, AI_PROVIDER: 'stub' }, { exportOptions: { pdfCompress: false, limits: { maxPages: 3, maxFileBytes: 100 } } });
  await ctx.reset();
  w = await world();
});
afterAll(async () => {
  await small.close();
  await ctx.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

// ---------- files ----------

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function upload(c: Client, pageId: string, data: Buffer, filename: string, mime: string) {
  const boundary = '----stillwater' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/pages/${pageId}/attachments`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: c.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; filename: string; mime: string; size: number };
}

// ---------- documents ----------

type J = Record<string, unknown>;
const t = (text: string, ...marks: J[]): J => (marks.length ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content: (J | string)[]): J => ({ type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? t(c) : c)) });
const doc = (...content: J[]) => ({ type: 'doc', content });
const li = (...content: J[]): J => ({ type: 'listItem', content });
const img = (attachmentId: string, caption = ''): J => ({ type: 'image', attrs: { attachmentId, caption, alt: '' } });
const link = (href: string): J => ({ type: 'link', attrs: { href } });

async function makePage(c: Client, title: string, parentId: string | null = null, body?: J, key = 'eng') {
  const res = await c.post(`/api/spaces/${key}/pages`, { title, parentId });
  expect(res.status).toBe(201);
  const id = res.body.page.id as string;
  if (body) await save(c, id, body);
  return id;
}

async function save(c: Client, id: string, body: J) {
  const cur = await c.get(`/api/pages/${id}`);
  const res = await c.put(`/api/pages/${id}`, { baseVersion: cur.body.page.version, doc: body });
  expect(res.status).toBe(200);
}

/**
 * Sam (instance editor) makes the restricted space "eng" ("Engineering"):
 * Ed is an editor member, Vi a viewer member; Nm is signed in but not a
 * member. Sam also makes "sec", a restricted space Vi cannot read.
 */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const sam = await signup(ctx.app, 'Sam');
  const ed = await signup(ctx.app, 'Ed');
  const vi = await signup(ctx.app, 'Vi');
  const nm = await signup(ctx.app, 'Nm');
  expect((await sam.client.post('/api/spaces', { key: 'eng', name: 'Engineering', visibility: 'restricted' })).status).toBe(201);
  expect((await sam.client.post('/api/spaces', { key: 'sec', name: 'Secret', visibility: 'restricted' })).status).toBe(201);
  await sam.client.put(`/api/spaces/eng/members/${ed.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${vi.user.id}`, { role: 'viewer' });
  return { ada, sam, ed, vi, nm };
}

// ---------- reading the answers ----------

async function exportRaw(c: Client | null, id: string, query: string, app = ctx.app) {
  return app.inject({ method: 'GET', url: `/api/pages/${id}/export?${query}`, headers: c?.cookie ? { cookie: c.cookie } : {} });
}

async function exportOk(c: Client, id: string, query: string, app = ctx.app) {
  const res = await exportRaw(c, id, query, app);
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  return res;
}

function zipOf(res: { rawPayload: Buffer; headers: Record<string, unknown> }) {
  expect(res.headers['content-type']).toBe('application/zip');
  return unzipSync(new Uint8Array(res.rawPayload));
}

const zipText = (files: Record<string, Uint8Array>) =>
  Object.entries(files)
    .filter(([name]) => name.endsWith('.md'))
    .map(([, data]) => strFromU8(data))
    .join('\n');

/**
 * The text of an uncompressed PDF, page by page. Embedded fonts are decoded
 * through their ToUnicode maps; the standard Courier font is single-byte.
 */
function pdfPages(buf: Buffer): string[] {
  const src = buf.toString('latin1');
  const objects = new Map<string, string>();
  for (const m of src.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objects.set(m[1]!, m[2]!);
  const stream = (body: string) => {
    const m = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    if (!m) return '';
    return /\/FlateDecode/.test(body) ? inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1') : m[1]!;
  };
  const hexToCodes = (hex: string, width: number) => {
    const out: number[] = [];
    for (let i = 0; i + width <= hex.length; i += width) out.push(parseInt(hex.slice(i, i + width), 16));
    return out;
  };
  const utf16 = (hex: string) => String.fromCharCode(...hexToCodes(hex, 4));
  const fontMaps = new Map<string, Map<number, string> | null>();
  const fontMap = (ref: string) => {
    if (fontMaps.has(ref)) return fontMaps.get(ref)!;
    const body = objects.get(ref) ?? '';
    const tu = /\/ToUnicode (\d+) 0 R/.exec(body);
    let map: Map<number, string> | null = null;
    if (tu) {
      map = new Map();
      const cmap = stream(objects.get(tu[1]!) ?? '');
      for (const r of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/gi)) {
        const lo = parseInt(r[1]!, 16);
        [...r[3]!.matchAll(/<([0-9a-f]+)>/gi)].forEach((u, i) => map!.set(lo + i, utf16(u[1]!)));
      }
      const ranges = cmap.replace(/\[[^\]]*\]/g, '');
      for (const r of ranges.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
        const lo = parseInt(r[1]!, 16);
        const hi = parseInt(r[2]!, 16);
        const start = parseInt(r[3]!, 16);
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(start + c - lo));
      }
    }
    fontMaps.set(ref, map);
    return map;
  };
  const pagesObj = [...objects.values()].find((b) => /\/Type \/Pages/.test(b))!;
  const kids = [.../\/Kids \[([^\]]*)\]/.exec(pagesObj)![1]!.matchAll(/(\d+) 0 R/g)].map((m) => m[1]!);
  return kids.map((kid) => {
    const page = objects.get(kid)!;
    const fonts = new Map<string, string>();
    const resRef = /\/Resources (\d+) 0 R/.exec(page)?.[1];
    const res = resRef ? objects.get(resRef)! : page;
    const fontDictRef = /\/Font (\d+) 0 R/.exec(res)?.[1];
    const fontDict = fontDictRef ? objects.get(fontDictRef)! : (/\/Font\s*<<([\s\S]*?)>>/.exec(res)?.[1] ?? '');
    for (const f of fontDict.matchAll(/\/(F\d+) (\d+) 0 R/g)) fonts.set(f[1]!, f[2]!);
    const contentRefs = [...(/\/Contents (\d+) 0 R/.exec(page)?.slice(1) ?? [])];
    let text = '';
    let map: Map<number, string> | null = null;
    for (const ref of contentRefs) {
      const ops = stream(objects.get(ref)!);
      for (const op of ops.matchAll(/\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-f]*>|[^\]])*)\]\s*TJ|<([0-9a-f]*)>\s*Tj/gi)) {
        if (op[1]) {
          map = fontMap(fonts.get(op[1])!);
          continue;
        }
        const hexes = op[2] !== undefined ? [...op[2].matchAll(/<([0-9a-f]*)>/gi)].map((h) => h[1]!) : [op[3]!];
        for (const hex of hexes) {
          if (map) text += hexToCodes(hex, 4).map((c) => map!.get(c) ?? '').join('');
          else text += Buffer.from(hex, 'hex').toString('latin1');
        }
        text += ' ';
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  });
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** Each needle appears in the text, in this order. */
function expectInOrder(text: string, needles: string[]) {
  const hay = squash(text);
  let from = 0;
  for (const n of needles) {
    const at = hay.indexOf(squash(n), from);
    expect(at, `"${n}" after position ${from}`).toBeGreaterThanOrEqual(from);
    from = at + squash(n).length;
  }
}

// ---------- tests ----------

describe('export: Markdown content', () => {
  it('a page holding every node type gives the Markdown written in the done-check, line for line', async () => {
    const { ed, vi } = w;
    const id = await makePage(ed.client, 'Everything');
    const png = await upload(ed.client, id, PNG, 'dot.png', 'image/png');
    const txt = await upload(ed.client, id, Buffer.from('hello notes\n'), 'notes.txt', 'text/plain');
    const mp4 = await upload(ed.client, id, Buffer.from('not really a video'), 'clip.mp4', 'video/mp4');
    const gone = '0b7c4b8e-1111-4aaa-8bbb-123456789abc';
    await save(
      ed.client,
      id,
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('Heading one')] },
        { type: 'heading', attrs: { level: 2 }, content: [t('Heading two')] },
        { type: 'heading', attrs: { level: 3 }, content: [t('Heading three')] },
        p(
          'Plain ',
          t('bold', { type: 'bold' }),
          ' ',
          t('italic', { type: 'italic' }),
          ' ',
          t('gone', { type: 'strike' }),
          ' ',
          t('x = 1', { type: 'code' }),
          ' ',
          t('site', link('https://example.com/a')),
        ),
        { type: 'bulletList', content: [li(p('One'), { type: 'bulletList', content: [li(p('One point one'))] }), li(p('Two'))] },
        { type: 'orderedList', content: [li(p('First')), li(p('Second'), { type: 'orderedList', content: [li(p('Inner'))] })] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p('Done thing')] },
            { type: 'taskItem', attrs: { checked: false, assignee: ed.user.id, due: '2026-12-01' }, content: [p('Open thing')] },
          ],
        },
        { type: 'blockquote', content: [p('Quoted words')] },
        { type: 'horizontalRule' },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;\nconsole.log(a);')] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('Name')] }, { type: 'tableHeader', content: [p('Note')] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p('pipe | here')] }, { type: 'tableCell', content: [p('line one'), p('line two')] }] },
          ],
        },
        { type: 'callout', attrs: { tone: 'info' }, content: [p('Info text')] },
        { type: 'callout', attrs: { tone: 'success' }, content: [p('Success text')] },
        { type: 'callout', attrs: { tone: 'warning' }, content: [p('Warning text')] },
        { type: 'callout', attrs: { tone: 'danger' }, content: [p('Danger text')] },
        img(png.id, 'A dot'),
        { type: 'file', attrs: { attachmentId: txt.id, filename: 'notes.txt', size: txt.size, mime: 'text/plain' } },
        { type: 'video', attrs: { attachmentId: mp4.id, filename: 'clip.mp4', mime: 'video/mp4' } },
        { type: 'video', attrs: { embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk' } },
        { type: 'linkPreview', attrs: { url: 'https://example.com/post', title: 'A post', description: 'About things', imageUrl: 'https://example.com/i.png' } },
        p('Ask ', { type: 'mention', attrs: { userId: ed.user.id, label: 'Old name' } }, ' and ', { type: 'mention', attrs: { userId: gone, label: 'Gone Person' } }, ' please'),
      ),
    );

    const res = await exportOk(vi.client, id, 'format=md');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Everything\.zip"/);
    const files = zipOf(res);
    expect(Object.keys(files).sort()).toEqual(
      ['everything.md', `attachments/${png.id}-dot.png`, `attachments/${txt.id}-notes.txt`, `attachments/${mp4.id}-clip.mp4`].sort(),
    );
    const expected = [
      '# Everything',
      '',
      '## Heading one',
      '',
      '### Heading two',
      '',
      '#### Heading three',
      '',
      'Plain **bold** *italic* ~~gone~~ `x = 1` [site](https://example.com/a)',
      '',
      '- One',
      '  - One point one',
      '- Two',
      '',
      '1. First',
      '2. Second',
      '   1. Inner',
      '',
      '- [x] Done thing',
      '- [ ] Open thing — @Ed, due 2026-12-01',
      '',
      '> Quoted words',
      '',
      '---',
      '',
      '```ts',
      'const a = 1;',
      'console.log(a);',
      '```',
      '',
      '| Name | Note |',
      '| --- | --- |',
      '| pipe \\| here | line one<br>line two |',
      '',
      '> **Note**',
      '>',
      '> Info text',
      '',
      '> **Tip**',
      '>',
      '> Success text',
      '',
      '> **Warning**',
      '>',
      '> Warning text',
      '',
      '> **Caution**',
      '>',
      '> Danger text',
      '',
      `![A dot](attachments/${png.id}-dot.png)`,
      '',
      '*A dot*',
      '',
      `[notes.txt](attachments/${txt.id}-notes.txt) (12 bytes)`,
      '',
      `[Video: clip.mp4](attachments/${mp4.id}-clip.mp4)`,
      '',
      '[Video](https://www.youtube-nocookie.com/embed/abcdefghijk)',
      '',
      '[A post](https://example.com/post)',
      '',
      'About things',
      '',
      'Ask @Ed and @Gone Person please',
      '',
    ].join('\n');
    expect(strFromU8(files['everything.md']!)).toBe(expected);
    expect(Buffer.from(files[`attachments/${png.id}-dot.png`]!)).toEqual(PNG);
  });

  it('text that looks like Markdown or HTML stays text', async () => {
    const id = await makePage(w.ed.client, 'Escape', null, doc(p('**not bold** <b>x</b> # not a heading'), p('1. not a list'), p('- not a bullet')));
    const res = await exportOk(w.vi.client, id, 'format=md');
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.body).toBe(
      ['# Escape', '', '\\*\\*not bold\\*\\* \\<b\\>x\\</b\\> \\# not a heading', '', '1\\. not a list', '', '\\- not a bullet', ''].join('\n'),
    );
  });
});

describe('export: single file or zip', () => {
  it('a page with no files is one .md; with an image it is a zip whose .md links to the same bytes by a relative path', async () => {
    const { ed, vi } = w;
    const plain = await makePage(ed.client, 'Plain page', null, doc(p('Just words.')));
    const res = await exportOk(vi.client, plain, 'format=md');
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Plain page\.md"/);
    expect(res.body).toBe('# Plain page\n\nJust words.\n');

    const pic = await makePage(ed.client, 'With picture');
    const png = await upload(ed.client, pic, PNG, 'dot.png', 'image/png');
    await save(ed.client, pic, doc(p('Look:'), img(png.id)));
    const files = zipOf(await exportOk(vi.client, pic, 'format=md'));
    expect(Object.keys(files).sort()).toEqual([`attachments/${png.id}-dot.png`, 'with-picture.md']);
    expect(Buffer.from(files[`attachments/${png.id}-dot.png`]!)).toEqual(PNG);
    expect(strFromU8(files['with-picture.md']!)).toContain(`![](attachments/${png.id}-dot.png)`);
  });

  it('two sibling pages with the same title get two different file names', async () => {
    const parent = await makePage(w.ed.client, 'Twins');
    await makePage(w.ed.client, 'Same', parent, doc(p('first twin')));
    await makePage(w.ed.client, 'Same', parent, doc(p('second twin')));
    const files = zipOf(await exportOk(w.vi.client, parent, 'format=md&children=1'));
    expect(Object.keys(files)).toEqual(['twins.md', 'twins/same.md', 'twins/same-2.md']);
    expect(strFromU8(files['twins/same.md']!)).toContain('first twin');
    expect(strFromU8(files['twins/same-2.md']!)).toContain('second twin');
  });
});

describe('export: sub-pages and trash', () => {
  let a: string, b: string, c: string, d: string, outside: string;

  beforeAll(async () => {
    const { ed } = w;
    outside = await makePage(ed.client, 'Outside', null, doc(p('Not in the tree.')));
    a = await makePage(ed.client, 'Alpha');
    b = await makePage(ed.client, 'Bravo', a, doc(p('Bravo words wombat.')));
    c = await makePage(ed.client, 'Charlie', b, doc(p('Charlie words caracal.')));
    d = await makePage(ed.client, 'Delta', a, doc(p('Delta words.')));
    // Move Delta first: sidebar order is A, D, B, C.
    expect((await ed.client.post(`/api/pages/${d}/move`, { parentId: a, index: 0 })).status).toBe(200);
    await save(ed.client, a, doc(p('Alpha words. See ', t('Delta', link(`/s/eng/p/${d}`)), ' and ', t('Outside', link(`/s/eng/p/${outside}`)), '.')));
  });

  it('children=1 has the page and every live sub-page in sidebar order, in nested folders; children=0 only the page; links point inside the export or to the wiki', async () => {
    const files = zipOf(await exportOk(w.vi.client, a, 'format=md&children=1'));
    expect(Object.keys(files)).toEqual(['alpha.md', 'alpha/delta.md', 'alpha/bravo.md', 'alpha/bravo/charlie.md']);
    const alpha = strFromU8(files['alpha.md']!);
    expect(alpha).toContain('[Delta](alpha/delta.md)');
    expect(alpha).toContain(`[Outside](http://wiki.test/s/eng/p/${outside})`);
    expect(strFromU8(files['alpha/bravo/charlie.md']!)).toBe('# Charlie\n\nCharlie words caracal.\n');

    const one = await exportOk(w.vi.client, a, 'format=md&children=0');
    expect(one.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(one.body).toContain('# Alpha');
    expect(one.body).not.toContain('Bravo');
    // Delta is not in this export, so the link goes to the wiki.
    expect(one.body).toContain(`[Delta](http://wiki.test/s/eng/p/${d})`);

    const page = await w.vi.client.get(`/api/pages/${a}`);
    expect(page.body.page.childCount).toBe(2);
    expect((await w.vi.client.get(`/api/pages/${c}`)).body.page.childCount).toBe(0);
  });

  it('a trashed sub-page and everything under it leave no trace; exporting them is 404; restore brings them back', async () => {
    const { ed, vi } = w;
    expect((await ed.client.del(`/api/pages/${b}`)).status).toBe(200);
    expect((await vi.client.get(`/api/pages/${a}`)).body.page.childCount).toBe(1);

    const files = zipOf(await exportOk(vi.client, a, 'format=md&children=1'));
    expect(Object.keys(files)).toEqual(['alpha.md', 'alpha/delta.md']);
    const all = Object.entries(files).map(([name, data]) => name + strFromU8(data)).join('\n');
    for (const gone of ['Bravo', 'bravo', 'wombat', 'Charlie', 'charlie', 'caracal']) expect(all).not.toContain(gone);

    const pdf = await exportOk(vi.client, a, 'format=pdf&children=1');
    const text = pdfPages(pdf.rawPayload).join(' ');
    expect(text).toContain('Delta words.');
    for (const gone of ['Bravo', 'wombat', 'Charlie', 'caracal']) expect(text).not.toContain(gone);
    expect(pdf.rawPayload.toString('latin1')).not.toMatch(/Bravo|Charlie/);

    for (const id of [b, c]) {
      expect((await exportRaw(vi.client, id, 'format=md')).statusCode).toBe(404);
      expect((await exportRaw(vi.client, id, 'format=pdf&children=1')).statusCode).toBe(404);
    }

    expect((await ed.client.post(`/api/pages/${b}/restore`)).status).toBe(200);
    const back = zipOf(await exportOk(vi.client, a, 'format=md&children=1'));
    expect(Object.keys(back)).toEqual(['alpha.md', 'alpha/delta.md', 'alpha/bravo.md', 'alpha/bravo/charlie.md']);
  });

  it('trashing the space makes every export in it 404', async () => {
    const { sam } = w;
    expect((await sam.client.post('/api/spaces', { key: 'tmp', name: 'Temporary', visibility: 'open' })).status).toBe(201);
    const top = await makePage(sam.client, 'Short lived', null, doc(p('Soon gone.')), 'tmp');
    const sub = await makePage(sam.client, 'Under it', top, undefined, 'tmp');
    expect((await exportRaw(sam.client, top, 'format=md')).statusCode).toBe(200);
    expect((await sam.client.del('/api/spaces/tmp')).status).toBeLessThan(300);
    for (const id of [top, sub]) {
      for (const q of ['format=md', 'format=md&children=1', 'format=pdf', 'format=pdf&children=1']) {
        expect((await exportRaw(sam.client, id, q)).statusCode).toBe(404);
      }
    }
  });

  it('PDF: every title, the space name and each block in order; contents list; each page on a new PDF page', async () => {
    const res = await exportOk(w.vi.client, a, 'format=pdf&children=1');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pages = pdfPages(res.rawPayload);
    expect(pages).toHaveLength(5);
    expectInOrder(pages[0]!, ['Alpha', 'Engineering', 'Exported', 'by Vi', 'Contents', 'Alpha', 'Delta', 'Bravo', 'Charlie']);
    const titles = ['Alpha', 'Delta', 'Bravo', 'Charlie'];
    const bodies = ['Alpha words. See Delta and Outside.', 'Delta words.', 'Bravo words wombat.', 'Charlie words caracal.'];
    titles.forEach((title, i) => {
      const page = pages[i + 1]!;
      expect(page.startsWith(title)).toBe(true);
      expectInOrder(page, [title, 'Engineering · Exported', bodies[i]!]);
    });
  });
});

describe('export: PDF content', () => {
  it('draws PNG and JPEG images, names a GIF, and keeps every block in order', async () => {
    const { ed, vi } = w;
    const id = await makePage(ed.client, 'Pictures');
    const png = await upload(ed.client, id, PNG, 'dot.png', 'image/png');
    const jpg = await upload(ed.client, id, JPEG, 'photo.jpg', 'image/jpeg');
    const gif = await upload(ed.client, id, GIF, 'moving.gif', 'image/gif');
    await save(
      ed.client,
      id,
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('First heading')] },
        p('Para ', t('bold', { type: 'bold' }), ' and ', t('code', { type: 'code' })),
        img(png.id, 'Png caption'),
        img(jpg.id, 'Jpeg caption'),
        img(gif.id, 'Gif caption'),
        { type: 'codeBlock', attrs: { language: 'js' }, content: [t('let x = 2;')] },
        { type: 'callout', attrs: { tone: 'warning' }, content: [p('Mind the step')] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('Head')] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', content: [p('Cell')] }] },
          ],
        },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, assignee: ed.user.id }, content: [p('Task words')] }] },
        { type: 'linkPreview', attrs: { url: 'https://example.com/card', title: 'Card title', description: 'Card text' } },
        p('Last line'),
      ),
    );
    const res = await exportOk(vi.client, id, 'format=pdf');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Pictures\.pdf"/);
    const raw = res.rawPayload.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(2);
    expect(raw).toContain('/DCTDecode');
    const [page] = pdfPages(res.rawPayload);
    expectInOrder(page!, [
      'Pictures',
      'Engineering · Exported',
      'First heading',
      'Para bold and code',
      'Png caption',
      'Jpeg caption',
      'Image: moving.gif',
      'Gif caption',
      'let x = 2;',
      'Warning',
      'Mind the step',
      'Head',
      'Cell',
      '[ ] Task words — @Ed',
      'Card title',
      'Card text',
      'Last line',
      '1 / 1',
    ]);
  });
});

describe('export: permissions', () => {
  it('a viewer member can export, a non-member editor gets 404, signed out gets 401; an image from a space the user cannot read is left out', async () => {
    const { sam, ed, vi, nm } = w;
    const secret = await makePage(sam.client, 'Hidden', null, undefined, 'sec');
    const hiddenJpeg = await upload(sam.client, secret, JPEG, 'hidden.jpg', 'image/jpeg');
    const id = await makePage(ed.client, 'Mixed');
    const mine = await upload(ed.client, id, PNG, 'dot.png', 'image/png');
    await save(ed.client, id, doc(p('Two pictures.'), img(hiddenJpeg.id, 'Secret caption'), img(mine.id)));

    expect((await exportRaw(vi.client, id, 'format=md')).statusCode).toBe(200);
    expect((await exportRaw(vi.client, id, 'format=pdf')).statusCode).toBe(200);
    expect((await exportRaw(nm.client, id, 'format=md')).statusCode).toBe(404);
    expect((await exportRaw(nm.client, id, 'format=pdf')).statusCode).toBe(404);
    expect((await exportRaw(null, id, 'format=md')).statusCode).toBe(401);

    const files = zipOf(await exportOk(vi.client, id, 'format=md'));
    expect(Object.keys(files).sort()).toEqual([`attachments/${mine.id}-dot.png`, 'mixed.md']);
    expect(strFromU8(files['mixed.md']!)).toBe(`# Mixed\n\nTwo pictures.\n\nImage not available\n\n![](attachments/${mine.id}-dot.png)\n`);
    for (const data of Object.values(files)) expect(Buffer.from(data).includes(JPEG.subarray(0, 40))).toBe(false);

    const pdf = await exportOk(vi.client, id, 'format=pdf');
    expect(pdfPages(pdf.rawPayload).join(' ')).toContain('Image not available');
    expect(pdf.rawPayload.toString('latin1')).not.toContain('/DCTDecode');
  });
});

describe('export: no outside fetch', () => {
  it('a link preview with an image address makes no outgoing request, in Markdown or PDF', async () => {
    const id = await makePage(
      w.ed.client,
      'Card page',
      null,
      doc({ type: 'linkPreview', attrs: { url: 'https://example.com/x', title: 'Remote', description: 'Far away', imageUrl: 'https://example.com/pic.png' } }),
    );
    const spies = [vi.spyOn(globalThis, 'fetch'), vi.spyOn(http, 'request'), vi.spyOn(http, 'get'), vi.spyOn(https, 'request'), vi.spyOn(https, 'get')];
    try {
      fetcherCalls = 0;
      const md = await exportOk(w.vi.client, id, 'format=md');
      expect(md.body).toContain('[Remote](https://example.com/x)');
      expect(md.body).not.toContain('pic.png');
      const pdf = await exportOk(w.vi.client, id, 'format=pdf');
      expect(pdfPages(pdf.rawPayload).join(' ')).toContain('Remote');
      expect(fetcherCalls).toBe(0);
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe('export: limits', () => {
  it('too many pages is 413 with the plain message, before any file is read', async () => {
    const top = await makePage(w.ed.client, 'Big tree');
    const png = await upload(w.ed.client, top, PNG, 'dot.png', 'image/png');
    await save(w.ed.client, top, doc(img(png.id)));
    for (const n of [1, 2, 3]) await makePage(w.ed.client, `Leaf ${n}`, top);
    const get = vi.spyOn(small.app.storage, 'get');
    try {
      for (const format of ['md', 'pdf']) {
        const res = await exportRaw(w.vi.client, top, `format=${format}&children=1`, small.app);
        expect(res.statusCode).toBe(413);
        expect(res.json().message).toBe('This export is too large: 4 pages, the limit is 3. Export a smaller part of the tree.');
      }
      expect(get).not.toHaveBeenCalled();
      expect((await exportRaw(w.vi.client, top, 'format=md&children=0', small.app)).statusCode).toBe(200);
    } finally {
      get.mockRestore();
    }
  });

  it('too many file bytes is 413 with the plain message, before any file is read', async () => {
    const id = await makePage(w.ed.client, 'Heavy');
    const big = await upload(w.ed.client, id, Buffer.alloc(150, 7), 'big.bin', 'application/octet-stream');
    await save(w.ed.client, id, doc({ type: 'file', attrs: { attachmentId: big.id, filename: 'big.bin', size: 150, mime: 'application/octet-stream' } }));
    const get = vi.spyOn(small.app.storage, 'get');
    try {
      const res = await exportRaw(w.vi.client, id, 'format=md', small.app);
      expect(res.statusCode).toBe(413);
      expect(res.json().message).toBe('This export is too large: 150 bytes of files, the limit is 100 bytes. Export a smaller part of the tree.');
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });

  it('check=1 (the screen asks this first) gives the same 413, 404 and 401 as the export, else 204 with no file, and reads no file', async () => {
    const top = await makePage(w.ed.client, 'Checked tree');
    const png = await upload(w.ed.client, top, PNG, 'dot.png', 'image/png');
    await save(w.ed.client, top, doc(img(png.id)));
    for (const n of [1, 2, 3]) await makePage(w.ed.client, `Checked leaf ${n}`, top);
    const get = vi.spyOn(small.app.storage, 'get');
    try {
      const big = await exportRaw(w.vi.client, top, 'format=pdf&children=1&check=1', small.app);
      expect(big.statusCode).toBe(413);
      expect(big.json().message).toBe('This export is too large: 4 pages, the limit is 3. Export a smaller part of the tree.');
      for (const format of ['md', 'pdf']) {
        const ok = await exportRaw(w.vi.client, top, `format=${format}&children=0&check=1`, small.app);
        expect(ok.statusCode).toBe(204);
        expect(ok.rawPayload.length).toBe(0);
        expect(ok.headers['content-disposition']).toBeUndefined();
        expect(ok.headers['cache-control']).toBe('no-store');
      }
      expect(get).not.toHaveBeenCalled();
      expect((await exportRaw(w.nm.client, top, 'format=md&check=1', small.app)).statusCode).toBe(404);
      expect((await exportRaw(null, top, 'format=md&check=1', small.app)).statusCode).toBe(401);
      expect((await exportRaw(w.vi.client, top, 'format=md&check=2', small.app)).statusCode).toBe(400);
    } finally {
      get.mockRestore();
      // To the trash, so the read-only test below (which exports every live page) has no more to do.
      expect((await w.ed.client.del(`/api/pages/${top}`)).status).toBe(200);
    }
  });
});

describe('export: read-only and headers', () => {
  it('pages.version, pages.updated_at and the count of page_versions are the same before and after every export', async () => {
    const snapshot = async () => ({
      pages: (await ctx.pool.query('select id, version, updated_at, doc from pages order by id')).rows,
      versions: (await ctx.pool.query('select count(*)::int as n from page_versions')).rows[0].n,
    });
    const before = await snapshot();
    const ids = (await ctx.pool.query<{ id: string }>('select id from pages where deleted_at is null')).rows.map((r) => r.id);
    for (const id of ids) {
      for (const q of ['format=md', 'format=md&children=1', 'format=pdf', 'format=pdf&children=1']) {
        expect([200, 404]).toContain((await exportRaw(w.ada.client, id, q)).statusCode);
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it('content type per format, attachment with a safe name, no-store; a wrong format is 400', async () => {
    const id = await makePage(w.ed.client, '../Plan "Q4"/é', null, doc(p('Plan.')));
    for (const [q, type, ext] of [
      ['format=md', 'text/markdown; charset=utf-8', 'md'],
      ['format=pdf', 'application/pdf', 'pdf'],
    ] as const) {
      const res = await exportOk(w.vi.client, id, q);
      expect(res.headers['content-type']).toBe(type);
      expect(res.headers['cache-control']).toBe('no-store');
      const cd = String(res.headers['content-disposition']);
      expect(cd).toBe(`attachment; filename="Plan Q4-_.${ext}"; filename*=UTF-8''${encodeURIComponent(`Plan Q4-é.${ext}`)}`);
      expect(cd).not.toMatch(/\.\.|\//);
    }
    const parent = await makePage(w.ed.client, 'Zip head');
    await makePage(w.ed.client, 'Zip child', parent);
    const zip = await exportOk(w.vi.client, parent, 'format=md&children=1');
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['cache-control']).toBe('no-store');
    expect(zip.headers['content-disposition']).toMatch(/^attachment; filename="Zip head\.zip"/);

    for (const q of ['format=docx', '', 'format=md&children=2']) expect((await exportRaw(w.vi.client, id, q)).statusCode).toBe(400);
  });
});
