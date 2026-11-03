import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupApp, signup, type TestCtx } from './helpers.js';
import { docToText } from '../src/pages/docText.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

async function space() {
  const ed = await signup(ctx.app, 'Ada');
  await ed.client.post('/api/spaces', { key: 'docs', name: 'Docs' });
  const create = async (title: string, parentId: string | null = null) => {
    const res = await ed.client.post('/api/spaces/docs/pages', { title, parentId });
    expect(res.status).toBe(201);
    return res.body.page.id as string;
  };
  const tree = async () =>
    (await ed.client.get('/api/spaces/docs/pages')).body.pages as { id: string; parentId: string | null; title: string }[];
  const titlesUnder = async (parentId: string | null) =>
    (await tree()).filter((p) => p.parentId === parentId).map((p) => p.title);
  return { ed, create, tree, titlesUnder };
}

describe('nested pages', () => {
  it('nest three deep with correct breadcrumbs', async () => {
    const { ed, create } = await space();
    const a = await create('Guides');
    const b = await create('Setup', a);
    const c = await create('Linux', b);
    const page = (await ed.client.get(`/api/pages/${c}`)).body.page;
    expect(page.title).toBe('Linux');
    expect(page.spaceKey).toBe('docs');
    expect(page.breadcrumbs.map((x: { title: string }) => x.title)).toEqual(['Guides', 'Setup']);
    expect(page.doc.content).toEqual([{ type: 'paragraph', attrs: { id: expect.any(String) } }]);
    expect(page.version).toBe(1);
  });

  it('keeps siblings in creation order and can reorder them', async () => {
    const { ed, create, titlesUnder } = await space();
    const ids = [];
    for (const t of ['One', 'Two', 'Three', 'Four']) ids.push(await create(t));
    expect(await titlesUnder(null)).toEqual(['One', 'Two', 'Three', 'Four']);

    await ed.client.post(`/api/pages/${ids[3]}/move`, { parentId: null, index: 0 });
    expect(await titlesUnder(null)).toEqual(['Four', 'One', 'Two', 'Three']);
    await ed.client.post(`/api/pages/${ids[3]}/move`, { parentId: null, index: 99 });
    expect(await titlesUnder(null)).toEqual(['One', 'Two', 'Three', 'Four']);
    await ed.client.post(`/api/pages/${ids[0]}/move`, { parentId: null, index: 2 });
    expect(await titlesUnder(null)).toEqual(['Two', 'Three', 'One', 'Four']);
  });

  it('moves a page with its children under another page, but never into itself', async () => {
    const { ed, create, titlesUnder } = await space();
    const a = await create('A');
    const b = await create('B');
    const b1 = await create('B1', b);
    await create('B1a', b1);

    expect((await ed.client.post(`/api/pages/${b}/move`, { parentId: a, index: 0 })).status).toBe(200);
    expect(await titlesUnder(a)).toEqual(['B']);
    expect(await titlesUnder(b1)).toEqual(['B1a']);
    const deep = (await ed.client.get(`/api/pages/${b1}`)).body.page;
    expect(deep.breadcrumbs.map((x: { title: string }) => x.title)).toEqual(['A', 'B']);

    expect((await ed.client.post(`/api/pages/${a}/move`, { parentId: b1, index: 0 })).status).toBe(400);
    expect((await ed.client.post(`/api/pages/${a}/move`, { parentId: a, index: 0 })).status).toBe(400);
  });

  it('refuses a parent from another space', async () => {
    const { ed, create } = await space();
    await ed.client.post('/api/spaces', { key: 'other', name: 'Other' });
    const elsewhere = (await ed.client.post('/api/spaces/other/pages', { title: 'X' })).body.page.id;
    expect((await ed.client.post('/api/spaces/docs/pages', { title: 'Y', parentId: elsewhere })).status).toBe(400);
    const here = await create('Here');
    expect((await ed.client.post(`/api/pages/${here}/move`, { parentId: elsewhere, index: 0 })).status).toBe(400);
  });

  it('saves title and body with version checks', async () => {
    const { ed, create } = await space();
    const id = await create('Draft');
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world ' }, { type: 'text', text: 'again' }] },
      ],
    };
    const saved = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, title: 'Final', doc });
    expect(saved.body).toEqual({ version: 2 });

    const stale = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, title: 'Lost update' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('stale_version');

    const page = (await ed.client.get(`/api/pages/${id}`)).body.page;
    expect(page).toMatchObject({ title: 'Final', version: 2, updatedBy: { name: 'Ada' } });
    expect(page.doc.content.map((b: { type: string }) => b.type)).toEqual(['heading', 'paragraph']);
    expect(page.doc.content[0].content[0].text).toBe('Hello');

    expect((await ed.client.put(`/api/pages/${id}`, { baseVersion: 2, doc: { type: 'nope' } })).status).toBe(400);
  });

  it('soft-deletes a page and everything under it', async () => {
    const { ed, create, tree } = await space();
    const keep = await create('Keep');
    const a = await create('A');
    const a1 = await create('A1', a);
    await create('A1x', a1);
    const res = await ed.client.del(`/api/pages/${a}`);
    expect(res.body.deleted).toBe(3);
    expect((await tree()).map((p) => p.id)).toEqual([keep]);
    expect((await ed.client.get(`/api/pages/${a1}`)).status).toBe(404);
    expect((await ed.client.post('/api/spaces/docs/pages', { title: 'Orphan', parentId: a })).status).toBe(400);
  });

  it('answers 404 for unknown or malformed page ids', async () => {
    const { ed } = await space();
    expect((await ed.client.get('/api/pages/123')).status).toBe(404);
    expect((await ed.client.get('/api/pages/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

const t = (text: string) => ({ type: 'text', text });
const p = (text: string) => ({ type: 'paragraph', content: [t(text)] });
const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({ type, content: [p(text)] });

/** One of every block and mark the editor offers in stage 2a. */
const EVERY_BLOCK = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Title')] },
    { type: 'heading', attrs: { level: 2 }, content: [t('Section')] },
    { type: 'heading', attrs: { level: 3 }, content: [t('Sub')] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'italic ', marks: [{ type: 'italic' }] },
        { type: 'text', text: 'strike ', marks: [{ type: 'strike' }] },
        { type: 'text', text: 'code ', marks: [{ type: 'code' }] },
        { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('bullet')] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p('numbered')] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('task')] }] },
    { type: 'blockquote', content: [p('quote')] },
    { type: 'horizontalRule' },
    { type: 'callout', attrs: { tone: 'warning' }, content: [p('careful')] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [t('const x = 1')] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', 'H1'), cell('tableHeader', 'H2')] },
        { type: 'tableRow', content: [cell('tableCell', 'c1'), cell('tableCell', 'c2')] },
      ],
    },
  ],
};

describe('docToText', () => {
  it('gives the text of every block type, code and table cells included, no attrs', () => {
    expect(docToText(EVERY_BLOCK).split('\n')).toEqual([
      'Title',
      'Section',
      'Sub',
      'bold italic strike code link',
      'bullet',
      'numbered',
      'task',
      'quote',
      'careful',
      'const x = 1',
      'H1',
      'H2',
      'c1',
      'c2',
    ]);
  });

  it('joins blocks with newlines and inline text without', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', marks: [{ type: 'bold' }], text: 'b' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }] }] },
        ],
      }),
    ).toBe('a b\nc');
  });
});

describe('page body validation', () => {
  async function page() {
    const ed = await signup(ctx.app, 'Ada');
    await ed.client.post('/api/spaces', { key: 'docs', name: 'Docs' });
    const id = (await ed.client.post('/api/spaces/docs/pages', { title: 'P' })).body.page.id as string;
    return { ed, id };
  }

  it('accepts a doc with every block type and gives each top-level block a unique id', async () => {
    const { ed, id } = await page();
    const res = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: EVERY_BLOCK });
    expect(res.status).toBe(200);
    const doc = (await ed.client.get(`/api/pages/${id}`)).body.page.doc;
    expect(doc.content.map((b: { type: string }) => b.type)).toEqual(EVERY_BLOCK.content.map((b) => b.type));
    const ids = doc.content.map((b: { attrs: { id: string } }) => b.attrs.id);
    expect(ids.every((x: string) => /^[0-9a-f-]{36}$/.test(x))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('replaces repeated block ids so no two top-level blocks share one', async () => {
    const { ed, id } = await page();
    const same = '11111111-1111-4111-8111-111111111111';
    const doc = { type: 'doc', content: [{ ...p('a'), attrs: { id: same } }, { ...p('b'), attrs: { id: same } }] };
    await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc });
    const stored = (await ed.client.get(`/api/pages/${id}`)).body.page.doc;
    expect(stored.content[0].attrs.id).toBe(same);
    expect(stored.content[1].attrs.id).not.toBe(same);
  });

  it.each([
    ['an unknown node', { type: 'doc', content: [{ type: 'marquee', content: [t('x')] }] }],
    ['a missing doc root', { type: 'paragraph', content: [t('x')] }],
    ['a node in the wrong place', { type: 'doc', content: [t('loose text')] }],
    ['an unknown mark', { type: 'doc', content: [{ type: 'paragraph', content: [{ ...t('x'), marks: [{ type: 'blink' }] }] }] }],
    [
      'a data: URL in attrs',
      { type: 'doc', content: [{ type: 'paragraph', content: [{ ...t('x'), marks: [{ type: 'link', attrs: { href: 'data:text/html;base64,PHNjcmlwdD4=' } }] }] }] },
    ],
    ['a data: URL on a block', { type: 'doc', content: [{ ...p('x'), attrs: { id: 'data:image/png;base64,AAAA' } }] }],
    [
      'a javascript: link',
      { type: 'doc', content: [{ type: 'paragraph', content: [{ ...t('x'), marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    ],
  ])('rejects %s with 400 and leaves the page alone', async (_name, doc) => {
    const { ed, id } = await page();
    const res = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc });
    expect(res.status).toBe(400);
    const stored = (await ed.client.get(`/api/pages/${id}`)).body.page;
    expect(stored.version).toBe(1);
    expect(JSON.stringify(stored.doc)).not.toContain('data:');
  });

  it('rejects an invalid doc on create too', async () => {
    const { ed } = await page();
    const res = await ed.client.post('/api/spaces/docs/pages', { title: 'X', doc: { type: 'doc', content: [{ type: 'nope' }] } });
    expect(res.status).toBe(400);
  });

  it('a stale baseVersion is 409 and does not change the stored doc', async () => {
    const { ed, id } = await page();
    expect((await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: { type: 'doc', content: [p('first')] } })).status).toBe(200);
    const stale = await ed.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: { type: 'doc', content: [p('second')] } });
    expect(stale.status).toBe(409);
    const stored = (await ed.client.get(`/api/pages/${id}`)).body.page;
    expect(stored.version).toBe(2);
    expect(stored.doc.content[0].content[0].text).toBe('first');
  });
});
