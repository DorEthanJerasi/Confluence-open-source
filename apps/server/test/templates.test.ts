// Page templates, server side (docs/done-checks/08-templates.md, "8a — Server"):
// the page_templates table, the built-ins, the template routes and new pages
// made from a template, all against real Postgres.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '@stillwater/shared';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';
import { BUILTIN_TEMPLATES } from '../src/templates/builtin.js';
import { normalizeDoc } from '../src/pages/docText.js';
import type { AiProvider } from '../src/ai/provider.js';
import { StubProvider } from '../src/ai/stub.js';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setupApp();
  await ctx.reset();
});
afterEach(() => ctx.close());

type Block = { type: string; attrs?: { id?: string } & Record<string, unknown>; content?: unknown[] };

const text = (t: string) => ({ type: 'text', text: t });
const para = (t: string) => ({ type: 'paragraph', content: [text(t)] });

/** A heading, a task list, a table and a code block. */
const richDoc: Doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Weekly sync')] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('Send the notes')] }] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [para('Owner')] }, { type: 'tableHeader', content: [para('Due')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [para('Bea')] }, { type: 'tableCell', content: [para('Friday')] }] },
      ],
    },
    { type: 'codeBlock', attrs: { language: 'bash' }, content: [text('npm run check')] },
  ],
} as Doc;

const pageDoc: Doc = {
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 1 }, content: [text('Runbook')] }, para('Restart the worker first.')],
} as Doc;

const blocks = (doc: unknown) => ((doc as { content?: Block[] }).content ?? []) as Block[];
const ids = (doc: unknown) => blocks(doc).map((b) => b.attrs?.id as string);
/** Task ids taken out anywhere in a node (they are made fresh, like block ids). */
const noTaskIds = (n: unknown): unknown => {
  if (!n || typeof n !== 'object') return n;
  const { attrs, content: kids, ...rest } = n as { attrs?: Record<string, unknown>; content?: unknown[] };
  return {
    ...rest,
    ...(attrs ? { attrs: 'taskId' in attrs ? { ...attrs, taskId: undefined } : attrs } : {}),
    ...(kids ? { content: kids.map(noTaskIds) } : {}),
  };
};
/** The doc with top-level block ids and task ids taken out, to compare content only. */
const content = (doc: unknown) =>
  blocks(doc).map((b) => noTaskIds({ ...b, attrs: { ...b.attrs, id: undefined } }));

/**
 * Restricted space "eng" made by Ada (instance admin). Bea is an editor of it,
 * Sam a space admin, Val a viewer, Nia not a member. Open space "ops" made by
 * Ada too. One page in eng.
 */
async function setup() {
  const ada = await signup(ctx.app, 'Ada');
  const bea = await signup(ctx.app, 'Bea');
  const sam = await signup(ctx.app, 'Sam');
  const val = await signup(ctx.app, 'Val');
  const nia = await signup(ctx.app, 'Nia');
  expect((await ada.client.post('/api/spaces', { key: 'eng', name: 'Engineering', visibility: 'restricted' })).status).toBe(201);
  expect((await ada.client.post('/api/spaces', { key: 'ops', name: 'Operations', visibility: 'restricted' })).status).toBe(201);
  for (const [who, role] of [
    [bea, 'editor'],
    [sam, 'admin'],
    [val, 'viewer'],
  ] as const) {
    expect((await ada.client.put(`/api/spaces/eng/members/${who.user.id}`, { role })).status).toBe(200);
  }
  expect((await ada.client.put(`/api/spaces/ops/members/${bea.user.id}`, { role: 'editor' })).status).toBe(200);
  const res = await ada.client.post('/api/spaces/eng/pages', { title: 'Runbook', parentId: null, doc: pageDoc });
  expect(res.status).toBe(201);
  return { ada, bea, sam, val, nia, pageId: res.body.page.id as string };
}

async function makeTemplate(c: Client, key: string, body: Record<string, unknown>) {
  const res = await c.post(`/api/spaces/${key}/templates`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.template as { id: string; name: string; version: number; doc: Doc; builtIn: boolean };
}

async function pageFrom(c: Client, key: string, templateId: string, title = 'From a template') {
  const res = await c.post(`/api/spaces/${key}/pages`, { title, parentId: null, templateId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.page as { id: string; doc: Doc; version: number };
}

const versionRows = async (pageId: string) =>
  (await ctx.pool.query('select count(*)::int as n from page_versions where page_id = $1', [pageId])).rows[0].n as number;

describe('built-in templates', () => {
  it('each passes normalizeDoc unchanged apart from block ids and has a heading and more', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual([
      'builtin:meeting-notes',
      'builtin:project-brief',
      'builtin:how-to-guide',
      'builtin:decision-record',
    ]);
    for (const t of BUILTIN_TEMPLATES) {
      const { doc } = normalizeDoc(t.doc);
      // Nothing is dropped or changed: the schema only adds block ids and attribute defaults.
      expect(doc, t.id).toMatchObject(t.doc);
      expect(content(normalizeDoc(doc).doc), t.id).toEqual(content(doc));
      expect(ids(doc).every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(blocks(t.doc).some((b) => b.type === 'heading'), t.id).toBe(true);
      expect(blocks(t.doc).length, t.id).toBeGreaterThan(1);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeLessThanOrEqual(200);
    }
  });

  it('an editor lists the four built-ins in order in a new space, with no docs', async () => {
    const { bea } = await setup();
    const res = await bea.client.get('/api/spaces/ops/templates');
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t: any) => t.name)).toEqual(['Meeting notes', 'Project brief', 'How-to guide', 'Decision record']);
    for (const t of res.body.templates) {
      expect(t.builtIn).toBe(true);
      expect(t).not.toHaveProperty('doc');
      expect(t).toMatchObject({ updatedAt: null, updatedBy: null });
    }
    const one = await bea.client.get('/api/spaces/ops/templates/builtin:meeting-notes');
    expect(one.status).toBe(200);
    expect(one.body.template).toMatchObject({ id: 'builtin:meeting-notes', builtIn: true, version: 1 });
    expect(blocks(one.body.template.doc)[0]!.type).toBe('heading');
  });
});

describe('space templates', () => {
  it('an editor creates one from a doc and one from a page; both are listed and GET returns their docs', async () => {
    const { bea, pageId } = await setup();
    const fromDoc = await makeTemplate(bea.client, 'eng', { name: '  Sync notes  ', description: ' Every Monday ', doc: richDoc });
    expect(fromDoc).toMatchObject({ name: 'Sync notes', builtIn: false, version: 1 });
    const fromPage = await makeTemplate(bea.client, 'eng', { name: 'Another runbook', fromPageId: pageId });

    const list = await bea.client.get('/api/spaces/eng/templates');
    expect(list.status).toBe(200);
    const names = list.body.templates.map((t: any) => t.name);
    expect(names).toEqual(['Meeting notes', 'Project brief', 'How-to guide', 'Decision record', 'Another runbook', 'Sync notes']);
    const own = list.body.templates.find((t: any) => t.id === fromDoc.id);
    expect(own).toMatchObject({ description: 'Every Monday', builtIn: false, updatedBy: { id: bea.user.id, name: 'Bea' } });
    expect(own).not.toHaveProperty('doc');

    const got = await bea.client.get(`/api/spaces/eng/templates/${fromDoc.id}`);
    expect(got.status).toBe(200);
    expect(content(got.body.template.doc)).toEqual(content(normalizeDoc(richDoc).doc));
    expect(blocks(got.body.template.doc).map((b) => b.type)).toEqual(['heading', 'taskList', 'table', 'codeBlock']);

    const page = (await bea.client.get(`/api/pages/${pageId}`)).body.page;
    const copy = (await bea.client.get(`/api/spaces/eng/templates/${fromPage.id}`)).body.template;
    expect(content(copy.doc)).toEqual(content(page.doc));
    const pageIds = new Set(ids(page.doc));
    expect(ids(copy.doc).some((id) => pageIds.has(id))).toBe(false);
  });

  it('a new page from a built-in and from a space template is a copy with new block ids, version 1, one history row', async () => {
    const { bea } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    const stored = (await bea.client.get(`/api/spaces/eng/templates/${tpl.id}`)).body.template.doc;

    for (const [templateId, source] of [
      ['builtin:decision-record', normalizeDoc(BUILTIN_TEMPLATES[3]!.doc).doc],
      [tpl.id, stored],
    ] as const) {
      const page = await pageFrom(bea.client, 'eng', templateId);
      expect(page.version).toBe(1);
      expect(await versionRows(page.id)).toBe(1);
      expect(content(page.doc)).toEqual(content(source));
      const pageIds = ids(page.doc);
      expect(new Set(pageIds).size).toBe(pageIds.length);
      const sourceIds = new Set(ids(source));
      expect(pageIds.some((id) => sourceIds.has(id))).toBe(false);
    }
    // Without templateId it works as before.
    const blank = await bea.client.post('/api/spaces/eng/pages', { title: 'Blank', parentId: null });
    expect(blank.status).toBe(201);
    expect(blocks(blank.body.page.doc).map((b) => b.type)).toEqual(['paragraph']);
  });

  it('two pages made from the same template share no block id', async () => {
    const { bea } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    for (const templateId of [tpl.id, 'builtin:meeting-notes']) {
      const a = await pageFrom(bea.client, 'eng', templateId, 'A');
      const b = await pageFrom(bea.client, 'eng', templateId, 'B');
      const aIds = new Set(ids(a.doc));
      expect(ids(b.doc).some((id) => aIds.has(id))).toBe(false);
    }
  });

  it('PATCH bumps the version, a stale baseVersion is 409, and pages made earlier never change; DELETE is 204', async () => {
    const { bea } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    const page = await pageFrom(bea.client, 'eng', tpl.id);
    const before = (await ctx.pool.query('select doc, version from pages where id = $1', [page.id])).rows[0];

    const newDoc = { type: 'doc', content: [para('Only this now')] };
    const res = await bea.client.patch(`/api/spaces/eng/templates/${tpl.id}`, { baseVersion: 1, name: 'Sync', description: 'Short', doc: newDoc });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.template).toMatchObject({ version: 2, name: 'Sync', description: 'Short', updatedBy: { id: bea.user.id, name: 'Bea' } });
    expect(blocks(res.body.template.doc).map((b) => b.type)).toEqual(['paragraph']);

    const stale = await bea.client.patch(`/api/spaces/eng/templates/${tpl.id}`, { baseVersion: 1, name: 'Late' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('stale_version');
    expect((await bea.client.get(`/api/spaces/eng/templates/${tpl.id}`)).body.template.name).toBe('Sync');

    expect((await ctx.pool.query('select doc, version from pages where id = $1', [page.id])).rows[0]).toEqual(before);
    const fresh = await pageFrom(bea.client, 'eng', tpl.id);
    expect(blocks(fresh.doc).map((b) => b.type)).toEqual(['paragraph']);

    const del = await bea.client.del(`/api/spaces/eng/templates/${tpl.id}`);
    expect(del.status).toBe(204);
    const list = (await bea.client.get('/api/spaces/eng/templates')).body.templates;
    expect(list.map((t: any) => t.id)).not.toContain(tpl.id);
    expect((await bea.client.get(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(404);
    expect((await ctx.pool.query('select doc, version from pages where id = $1', [page.id])).rows[0]).toEqual(before);
    expect((await bea.client.get(`/api/pages/${page.id}`)).status).toBe(200);
  });

  it('checks names, descriptions, unknown fields and the doc', async () => {
    const { bea } = await setup();
    await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    const post = (body: Record<string, unknown>, key = 'eng') => bea.client.post(`/api/spaces/${key}/templates`, body);

    const clash = await post({ name: 'SYNC NOTES', doc: richDoc });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('name_taken');
    expect((await post({ name: 'sync notes', doc: richDoc }, 'ops')).status).toBe(201);
    // A built-in's name is allowed.
    expect((await post({ name: 'Meeting notes', doc: richDoc })).status).toBe(201);

    expect((await post({ name: '   ', doc: richDoc })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(81), doc: richDoc })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(80), doc: richDoc })).status).toBe(201);
    expect((await post({ name: 'Long words', description: 'y'.repeat(201), doc: richDoc })).status).toBe(400);
    expect((await post({ name: 'Unknown', doc: richDoc, color: 'red' })).status).toBe(400);
    expect((await post({ name: 'Bad doc', doc: { type: 'doc', content: [{ type: 'marquee' }] } })).status).toBe(400);
    expect((await post({ name: 'Neither' })).status).toBe(400);

    // PATCH: a clash with another template is 409; bad input is 400.
    const other = await makeTemplate(bea.client, 'eng', { name: 'Other', doc: richDoc });
    const patch = (body: Record<string, unknown>) => bea.client.patch(`/api/spaces/eng/templates/${other.id}`, body);
    expect((await patch({ baseVersion: 1, name: 'sync NOTES' })).status).toBe(409);
    expect((await patch({ baseVersion: 1, name: '' })).status).toBe(400);
    expect((await patch({ baseVersion: 1, description: 'z'.repeat(201) })).status).toBe(400);
    expect((await patch({ baseVersion: 1, doc: { type: 'doc', content: [{ type: 'marquee' }] } })).status).toBe(400);
    expect((await patch({ baseVersion: 1, extra: true })).status).toBe(400);
    expect((await patch({ baseVersion: 1 })).status).toBe(400);
    expect((await bea.client.get(`/api/spaces/eng/templates/${other.id}`)).body.template).toMatchObject({ name: 'Other', version: 1 });
  });

  it('a page with both doc and templateId, or an unknown templateId, is 400', async () => {
    const { bea } = await setup();
    const both = await bea.client.post('/api/spaces/eng/pages', { title: 'x', parentId: null, doc: pageDoc, templateId: 'builtin:meeting-notes' });
    expect(both.status).toBe(400);
    for (const templateId of ['builtin:nope', 'nope', '00000000-0000-4000-8000-000000000000']) {
      expect((await bea.client.post('/api/spaces/eng/pages', { title: 'x', parentId: null, templateId })).status).toBe(400);
    }
  });

  it('a space template is 404 from another space and 400 as templateId there; fromPageId from another space is 400', async () => {
    const { bea, pageId } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    expect((await bea.client.get(`/api/spaces/ops/templates/${tpl.id}`)).status).toBe(404);
    expect((await bea.client.patch(`/api/spaces/ops/templates/${tpl.id}`, { baseVersion: 1, name: 'Hijack' })).status).toBe(404);
    expect((await bea.client.del(`/api/spaces/ops/templates/${tpl.id}`)).status).toBe(404);
    expect((await bea.client.post('/api/spaces/ops/pages', { title: 'x', parentId: null, templateId: tpl.id })).status).toBe(400);
    expect((await bea.client.post('/api/spaces/ops/templates', { name: 'Copy', fromPageId: pageId })).status).toBe(400);
    // A deleted page cannot be copied either.
    expect((await bea.client.del(`/api/pages/${pageId}`)).status).toBe(200);
    expect((await bea.client.post('/api/spaces/eng/templates', { name: 'Copy', fromPageId: pageId })).status).toBe(400);
    // Still intact in its own space.
    expect((await bea.client.get(`/api/spaces/eng/templates/${tpl.id}`)).body.template.name).toBe('Sync notes');
  });

  it('a built-in cannot be changed or deleted by an editor, a space admin or an instance admin', async () => {
    const { ada, bea, sam } = await setup();
    for (const c of [bea.client, sam.client, ada.client]) {
      expect((await c.patch('/api/spaces/eng/templates/builtin:meeting-notes', { baseVersion: 1, name: 'Mine' })).status).toBe(403);
      expect((await c.del('/api/spaces/eng/templates/builtin:meeting-notes')).status).toBe(403);
    }
    expect((await bea.client.get('/api/spaces/eng/templates/builtin:meeting-notes')).body.template.name).toBe('Meeting notes');
  });

  it('a viewer of the space gets 403 everywhere', async () => {
    const { bea, val } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    const c = val.client;
    expect((await c.get('/api/spaces/eng/templates')).status).toBe(403);
    expect((await c.get(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(403);
    expect((await c.get('/api/spaces/eng/templates/builtin:meeting-notes')).status).toBe(403);
    expect((await c.post('/api/spaces/eng/templates', { name: 'Mine', doc: richDoc })).status).toBe(403);
    expect((await c.patch(`/api/spaces/eng/templates/${tpl.id}`, { baseVersion: 1, name: 'Mine' })).status).toBe(403);
    expect((await c.del(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(403);
    expect((await c.post('/api/spaces/eng/pages', { title: 'x', parentId: null, templateId: tpl.id })).status).toBe(403);
    expect((await c.post('/api/spaces/eng/pages', { title: 'x', parentId: null, templateId: 'builtin:meeting-notes' })).status).toBe(403);
  });

  it('a non-member of a restricted space gets 404 on every route; added as editor it works; removed, 404 again', async () => {
    const { ada, bea, nia } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    const routes = (c: Client) => [
      () => c.get('/api/spaces/eng/templates'),
      () => c.get(`/api/spaces/eng/templates/${tpl.id}`),
      () => c.get('/api/spaces/eng/templates/builtin:meeting-notes'),
      () => c.post('/api/spaces/eng/templates', { name: 'Nia', doc: richDoc }),
      // A body that would be 400 still gives 404: nothing is learned about the space.
      () => c.post('/api/spaces/eng/templates', { name: '' }),
      () => c.patch(`/api/spaces/eng/templates/${tpl.id}`, { baseVersion: 1, name: 'Nia' }),
      () => c.patch('/api/spaces/eng/templates/builtin:meeting-notes', { baseVersion: 1, name: 'Nia' }),
      () => c.del(`/api/spaces/eng/templates/${tpl.id}`),
      () => c.del('/api/spaces/eng/templates/builtin:meeting-notes'),
      () => c.post('/api/spaces/eng/pages', { title: 'x', parentId: null, templateId: tpl.id }),
    ];
    for (const call of routes(nia.client)) expect((await call()).status).toBe(404);

    expect((await ada.client.put(`/api/spaces/eng/members/${nia.user.id}`, { role: 'editor' })).status).toBe(200);
    expect((await nia.client.get('/api/spaces/eng/templates')).status).toBe(200);
    expect((await nia.client.get(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(200);
    await pageFrom(nia.client, 'eng', tpl.id);
    const mine = await makeTemplate(nia.client, 'eng', { name: 'Nia notes', doc: richDoc });
    expect((await nia.client.patch(`/api/spaces/eng/templates/${mine.id}`, { baseVersion: 1, name: 'Nia’s notes' })).status).toBe(200);
    expect((await nia.client.del(`/api/spaces/eng/templates/${mine.id}`)).status).toBe(204);

    expect((await ada.client.del(`/api/spaces/eng/members/${nia.user.id}`)).status).toBe(200);
    for (const call of routes(nia.client)) expect((await call()).status).toBe(404);
  });

  it('purging the space from the trash removes its templates; deleting a page leaves templates made from it', async () => {
    const { ada, bea, pageId } = await setup();
    const fromPage = await makeTemplate(bea.client, 'eng', { name: 'From page', fromPageId: pageId });
    await makeTemplate(bea.client, 'ops', { name: 'Ops one', doc: richDoc });
    expect((await bea.client.del(`/api/pages/${pageId}`)).status).toBe(200);
    expect((await bea.client.get(`/api/spaces/eng/templates/${fromPage.id}`)).status).toBe(200);

    const count = async (key: string) =>
      (await ctx.pool.query('select count(*)::int as n from page_templates t join spaces s on s.id = t.space_id where s.key = $1', [key])).rows[0].n;
    expect(await count('eng')).toBe(1);
    // Deleting the space moves it to the trash (done-check 11): its templates are
    // hidden but kept, and go only when the space is purged.
    const engId = (await ada.client.get('/api/spaces/eng')).body.space.id as string;
    expect((await ada.client.del('/api/spaces/eng')).status).toBe(204);
    expect((await bea.client.get(`/api/spaces/eng/templates/${fromPage.id}`)).status).toBe(404);
    expect(await count('eng')).toBe(1);
    expect((await ada.client.del(`/api/trash/spaces/${engId}`)).status).toBe(204);
    expect((await ctx.pool.query('select count(*)::int as n from page_templates where id = $1', [fromPage.id])).rows[0].n).toBe(0);
    expect(await count('ops')).toBe(1);
  });

  it('a name with markup comes back as the same text', async () => {
    const { bea } = await setup();
    const name = '<img src=x onerror=alert(1)>';
    const tpl = await makeTemplate(bea.client, 'eng', { name, description: '<b>bold</b>', doc: richDoc });
    expect(tpl.name).toBe(name);
    const got = (await bea.client.get(`/api/spaces/eng/templates/${tpl.id}`)).body.template;
    expect(got).toMatchObject({ name, description: '<b>bold</b>' });
    expect((await bea.client.get('/api/spaces/eng/templates')).body.templates.at(-1).name).toBe(name);
  });

  it('signed out is 401 on every route', async () => {
    const { bea } = await setup();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'Sync notes', doc: richDoc });
    const anon = new Client(ctx.app);
    expect((await anon.get('/api/spaces/eng/templates')).status).toBe(401);
    expect((await anon.get(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(401);
    expect((await anon.post('/api/spaces/eng/templates', { name: 'x', doc: richDoc })).status).toBe(401);
    expect((await anon.patch(`/api/spaces/eng/templates/${tpl.id}`, { baseVersion: 1, name: 'x' })).status).toBe(401);
    expect((await anon.del(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(401);
    expect((await anon.post('/api/spaces/eng/pages', { title: 'x', parentId: null, templateId: tpl.id })).status).toBe(401);
  });

  it('template routes write no page, version or history row', async () => {
    const { bea, pageId } = await setup();
    const snapshot = async () => ({
      pages: (await ctx.pool.query('select id, version, doc, updated_at from pages order by id')).rows,
      versions: (await ctx.pool.query('select count(*)::int as n from page_versions')).rows[0].n,
    });
    const before = await snapshot();
    const tpl = await makeTemplate(bea.client, 'eng', { name: 'From page', fromPageId: pageId });
    await bea.client.get('/api/spaces/eng/templates');
    await bea.client.get(`/api/spaces/eng/templates/${tpl.id}`);
    expect((await bea.client.patch(`/api/spaces/eng/templates/${tpl.id}`, { baseVersion: 1, doc: richDoc })).status).toBe(200);
    expect((await bea.client.del(`/api/spaces/eng/templates/${tpl.id}`)).status).toBe(204);
    expect(await snapshot()).toEqual(before);
  });
});

describe('templates stay out of search and AI', () => {
  it('a word only in a template is not found by search, and AI ask never receives template text', async () => {
    const sent: string[] = [];
    const stub = new StubProvider();
    const provider: AiProvider = {
      name: 'recorder',
      async complete(req) {
        sent.push(JSON.stringify(req));
        return stub.complete(req);
      },
    };
    await ctx.close();
    ctx = await setupApp({ AI_PROVIDER: 'stub' }, { aiProvider: provider });
    await ctx.reset();
    const { bea } = await setup();
    // One page so ask has something to retrieve, and the template with the secret word.
    expect((await bea.client.post('/api/spaces/eng/pages', { title: 'Zebra care', parentId: null, doc: { type: 'doc', content: [para('Feed the zebra hay.')] } })).status).toBe(201);
    await makeTemplate(bea.client, 'eng', {
      name: 'Quokkatemplate',
      description: 'quokka',
      doc: { type: 'doc', content: [para('The quokka lives only in this template.')] },
    });

    for (const q of ['quokka', 'quokkatemplate']) {
      const res = await bea.client.get(`/api/search?q=${q}`);
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    }
    const ask = await bea.client.post('/api/ai/ask', { question: 'Where does the quokka or the zebra live?' });
    expect(ask.status).toBe(200);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).toContain('zebra hay');
    expect(sent.join('\n').toLowerCase()).not.toContain('quokka lives');
    expect(sent.join('\n').toLowerCase()).not.toContain('quokkatemplate');
    expect(JSON.stringify(ask.body).toLowerCase()).not.toContain('quokka lives');
  });
});
