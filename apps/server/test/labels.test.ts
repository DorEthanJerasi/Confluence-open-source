// Labels, server side (docs/done-checks/13-labels.md, "13a — Server"): the
// name rule, add and remove as set operations with stable ids, labels never
// touching the page, who may do what, the per-space and whole-wiki views, the
// suggestions, trash, the label filter in search, order and limits, and 401
// when signed out. Real Postgres.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LABEL_NAME_MESSAGE, normaliseLabel } from '@stillwater/shared';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';
import { createPage } from '../src/pages/pages.js';

let ctx: TestCtx;
let w: Awaited<ReturnType<typeof world>>;

// Signups are rate-limited per address, so the people and spaces are made once
// for the file; each test starts with no pages (labels rows stay, as they do
// in real use).
beforeAll(async () => {
  ctx = await setupApp({ AI_PROVIDER: 'stub' });
  await ctx.reset();
  w = await world();
});
beforeEach(async () => {
  await ctx.pool.query('truncate pages cascade');
});
afterAll(async () => {
  await ctx.close();
});

/**
 * Ada is the instance admin and no member of anything. Sam makes the open
 * spaces "alpha" and "beta" and the restricted space "red". Ed is an editor in
 * alpha and beta, Vi a viewer in alpha, Ro an editor in red. Nm is signed in
 * and a member of nothing.
 */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const sam = await signup(ctx.app, 'Sam');
  const ed = await signup(ctx.app, 'Ed');
  const vi = await signup(ctx.app, 'Vi');
  const ro = await signup(ctx.app, 'Ro');
  const nm = await signup(ctx.app, 'Nm');
  for (const [key, name, visibility] of [
    ['alpha', 'Alpha', 'open'],
    ['beta', 'Beta', 'open'],
    ['red', 'Red', 'restricted'],
  ] as const) {
    expect((await sam.client.post('/api/spaces', { key, name, visibility })).status).toBe(201);
  }
  await sam.client.put(`/api/spaces/alpha/members/${ed.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/beta/members/${ed.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/alpha/members/${vi.user.id}`, { role: 'viewer' });
  await sam.client.put(`/api/spaces/red/members/${ro.user.id}`, { role: 'editor' });
  return { ada, sam, ed, vi, ro, nm };
}

const p = (text: string) => ({ type: 'paragraph', attrs: { id: `b-${text.slice(0, 8)}` }, content: [{ type: 'text', text }] });

/** A page made by Sam (space admin everywhere), optionally with body text. */
async function makePage(key: string, title: string, body?: string, parentId: string | null = null) {
  const res = await w.sam.client.post(`/api/spaces/${key}/pages`, { title, parentId });
  expect(res.status).toBe(201);
  const id = res.body.page.id as string;
  if (body) expect((await w.sam.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: { type: 'doc', content: [p(body)] } })).status).toBe(200);
  return id;
}

const add = (c: Client, pageId: string, name: string) => c.post(`/api/pages/${pageId}/labels`, { name });
const remove = (c: Client, pageId: string, labelId: string) => c.del(`/api/pages/${pageId}/labels/${labelId}`);
const names = (labels: { name: string }[]) => labels.map((l) => l.name);
const pageLabels = async (c: Client, id: string) => (await c.get(`/api/pages/${id}`)).body.page.labels as { id: string; name: string }[];
const view = async (c: Client, name: string, key?: string) => {
  const res = await c.get(key ? `/api/spaces/${key}/labels/${encodeURIComponent(name)}/pages` : `/api/labels/${encodeURIComponent(name)}/pages`);
  return { status: res.status, body: res.body };
};
const viewTitles = async (c: Client, name: string, key?: string) => ((await view(c, name, key)).body.pages as { title: string }[]).map((x) => x.title);
const suggest = async (c: Client, q = '') =>
  (await c.get(`/api/labels${q ? `?q=${encodeURIComponent(q)}` : ''}`)).body.labels as { id: string; name: string; count: number }[];
const search = async (c: Client, qs: string) => {
  const res = await c.get(`/api/search?${qs}`);
  expect(res.status).toBe(200);
  return res.body.results as { title: string; labels: { id: string; name: string }[] }[];
};
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
/** Make `ids` changed in this order, oldest first, so newest-first order is known. */
async function ageInOrder(ids: string[]) {
  for (const [i, id] of ids.entries()) {
    await ctx.pool.query(`update pages set updated_at = now() - make_interval(mins => $1) where id = $2`, [ids.length - i, id]);
  }
}

describe('normaliseLabel', () => {
  it('keeps one name form and refuses the rest', () => {
    expect(normaliseLabel('  Team Notes ')).toBe('team-notes');
    expect(normaliseLabel('Año_2026')).toBe('año_2026');
    expect(normaliseLabel('a   b')).toBe('a-b');
    expect(normaliseLabel('x'.repeat(40))).toBe('x'.repeat(40));
    for (const bad of ['', '   ', 'a/b', '<b>', 'x'.repeat(41), 'a.b', 'a#b']) expect(normaliseLabel(bad), bad).toBeNull();
    expect(normaliseLabel(7)).toBeNull();
  });
});

describe('labels on a page', () => {
  it('adds and removes as a set, by name, with a limit of 20 and a name rule', async () => {
    const page = await makePage('alpha', 'Plans');
    let res = await add(w.ed.client, page, 'design');
    expect(res.status).toBe(200);
    expect(names(res.body.labels)).toEqual(['design']);
    res = await add(w.ed.client, page, 'q4-plans');
    expect(names(res.body.labels)).toEqual(['design', 'q4-plans']);
    expect(names(await pageLabels(w.ed.client, page))).toEqual(['design', 'q4-plans']);

    // Same name in another case: 200, still two.
    res = await add(w.ed.client, page, 'Design');
    expect(res.status).toBe(200);
    expect(names(res.body.labels)).toEqual(['design', 'q4-plans']);

    const design = res.body.labels[0].id as string;
    res = await remove(w.ed.client, page, design);
    expect(res.status).toBe(200);
    expect(names(res.body.labels)).toEqual(['q4-plans']);
    res = await remove(w.ed.client, page, design);
    expect(res.status).toBe(200);
    expect(names(res.body.labels)).toEqual(['q4-plans']);
    // An id that is no label at all, or no uuid: still no change.
    expect((await remove(w.ed.client, page, '00000000-0000-4000-8000-000000000000')).status).toBe(200);
    expect((await remove(w.ed.client, page, 'nope')).body.labels).toHaveLength(1);

    // Up to 20; the 21st is refused and nothing is added.
    for (let i = 1; i < 20; i++) expect((await add(w.ed.client, page, `tag-${i}`)).status).toBe(200);
    expect(await pageLabels(w.ed.client, page)).toHaveLength(20);
    res = await add(w.ed.client, page, 'one-too-many');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A page can have at most 20 labels');
    expect(await pageLabels(w.ed.client, page)).toHaveLength(20);
    // One it already has is still a 200 at the limit.
    expect((await add(w.ed.client, page, 'tag-3')).status).toBe(200);

    // A bad name is a 400 with a plain message.
    for (const bad of ['a/b', '', '   ', 'x'.repeat(41)]) {
      res = await add(w.ed.client, page, bad);
      expect(res.status, bad).toBe(400);
    }
    expect((await add(w.ed.client, page, 'a/b')).body.message).toBe(LABEL_NAME_MESSAGE);
    expect((await w.ed.client.post(`/api/pages/${page}/labels`, {})).status).toBe(400);
    expect(await pageLabels(w.ed.client, page)).toHaveLength(20);
    const { rows } = await ctx.pool.query(`select count(*)::int as n from labels where name = 'one-too-many'`);
    expect(rows[0].n).toBe(0);
  });

  it('keeps label ids stable across pages and after no page uses a label', async () => {
    const one = await makePage('alpha', 'One');
    const two = await makePage('beta', 'Two');
    const first = (await add(w.ed.client, one, 'stable')).body.labels[0].id as string;
    const second = (await add(w.ed.client, two, 'Stable')).body.labels[0].id as string;
    expect(second).toBe(first);
    await remove(w.ed.client, one, first);
    await remove(w.ed.client, two, first);
    // Unused now: hidden everywhere, but the row and its id stay.
    expect(names(await suggest(w.sam.client, 'stable'))).toEqual([]);
    expect((await add(w.ed.client, one, 'stable')).body.labels[0].id).toBe(first);
  });

  it('never touches the page text, its version, its time or its history', async () => {
    const page = await makePage('alpha', 'Calm page', 'Original words');
    const snap = async () => {
      const { rows } = await ctx.pool.query(
        `select doc, version, updated_at, (select count(*)::int from page_versions where page_id = $1) as versions from pages where id = $1`,
        [page],
      );
      return rows[0];
    };
    const before = await snap();
    const id = (await add(w.ed.client, page, 'calm')).body.labels[0].id as string;
    await add(w.ed.client, page, 'quiet');
    await remove(w.ed.client, page, id);
    expect(await snap()).toEqual(before);

    // An editor who opened the page before the labels changed saves with no conflict.
    const save = await w.ed.client.put(`/api/pages/${page}`, { baseVersion: before.version, doc: { type: 'doc', content: [p('Newer words')] } });
    expect(save.status).toBe(200);

    // Restoring an older version keeps today's labels.
    const versions = (await w.sam.client.get(`/api/pages/${page}/versions`)).body.versions as { version: number }[];
    const oldest = versions.at(-1)!.version;
    expect(oldest).toBeLessThan(save.body.version);
    const restore = await w.sam.client.post(`/api/pages/${page}/versions/${oldest}/restore`, { baseVersion: save.body.version });
    expect(restore.status).toBe(200);
    expect(names(await pageLabels(w.sam.client, page))).toEqual(['quiet']);
  });

  it('lets viewers read labels only, hides restricted pages, and lets an instance admin add', async () => {
    const open = await makePage('alpha', 'Open page');
    await add(w.ed.client, open, 'shared');
    const labelId = (await pageLabels(w.ed.client, open))[0]!.id;

    // Viewer: sees the labels, 403 on add and remove.
    expect(names(await pageLabels(w.vi.client, open))).toEqual(['shared']);
    expect((await add(w.vi.client, open, 'mine')).status).toBe(403);
    expect((await remove(w.vi.client, open, labelId)).status).toBe(403);
    expect(names(await pageLabels(w.ed.client, open))).toEqual(['shared']);

    // Not a member of the restricted space: 404 on the page, add and remove.
    const secret = await makePage('red', 'Secret page');
    expect((await add(w.ro.client, secret, 'hidden')).status).toBe(200);
    const hiddenId = (await pageLabels(w.ro.client, secret))[0]!.id;
    expect((await w.nm.client.get(`/api/pages/${secret}`)).status).toBe(404);
    expect((await add(w.nm.client, secret, 'x')).status).toBe(404);
    expect((await remove(w.nm.client, secret, hiddenId)).status).toBe(404);
    expect((await add(w.nm.client, '00000000-0000-4000-8000-000000000000', 'x')).status).toBe(404);
    expect((await add(w.nm.client, 'not-a-uuid', 'x')).status).toBe(404);

    // Instance admin, no member: may add.
    const res = await add(w.ada.client, secret, 'audit');
    expect(res.status).toBe(200);
    expect(names(res.body.labels)).toEqual(['audit', 'hidden']);
  });
});

describe('label views and suggestions', () => {
  it('shows only pages the person can see, in the whole wiki and in one space', async () => {
    const a = await makePage('alpha', 'In alpha');
    const r = await makePage('red', 'In red');
    const b = await makePage('beta', 'In beta');
    await ageInOrder([a, r, b]);
    for (const id of [a, r, b]) expect((await add(w.sam.client, id, 'design')).status).toBe(200);
    await add(w.sam.client, r, 'red-only');
    await add(w.sam.client, a, 'extra');

    // Ed: member of alpha and beta, not red.
    expect(await viewTitles(w.ed.client, 'design')).toEqual(['In beta', 'In alpha']);
    expect(await viewTitles(w.ed.client, 'design', 'alpha')).toEqual(['In alpha']);
    expect((await view(w.ed.client, 'design', 'red')).status).toBe(404);
    // Ro (member of red, and alpha and beta are open) and Ada see all three.
    expect(await viewTitles(w.ro.client, 'design')).toEqual(['In beta', 'In red', 'In alpha']);
    expect(await viewTitles(w.ada.client, 'design')).toEqual(['In beta', 'In red', 'In alpha']);
    expect(await viewTitles(w.ro.client, 'design', 'red')).toEqual(['In red']);

    // The shape of a view: label, pages with their space and all their labels.
    const full = await view(w.ed.client, 'Design');
    expect(full.status).toBe(200);
    expect(full.body.label).toEqual({ id: expect.any(String), name: 'design' });
    expect(full.body.truncated).toBe(false);
    expect(full.body.pages[1]).toEqual({
      id: a,
      title: 'In alpha',
      space: { key: 'alpha', name: 'Alpha' },
      updatedAt: expect.any(String),
      labels: [
        { id: expect.any(String), name: 'design' },
        { id: expect.any(String), name: 'extra' },
      ],
    });

    // Suggestions count only what Ed can see; a red-only label is not listed.
    const forEd = await suggest(w.ed.client);
    expect(forEd.find((l) => l.name === 'design')?.count).toBe(2);
    expect(forEd.find((l) => l.name === 'red-only')).toBeUndefined();
    expect((await suggest(w.ro.client)).find((l) => l.name === 'red-only')?.count).toBe(1);
    expect((await suggest(w.ro.client)).find((l) => l.name === 'design')?.count).toBe(3);

    // A label Ed cannot see a page for looks like one never used.
    const never = { label: null, pages: [], truncated: false };
    expect((await view(w.ed.client, 'red-only')).body).toEqual(never);
    expect((await view(w.ed.client, 'never-used')).body).toEqual(never);
    expect((await view(w.ed.client, 'red-only', 'alpha')).body).toEqual(never);
    // A name that breaks the rule is no label: the same answer.
    expect((await view(w.ed.client, 'a.b')).body).toEqual(never);
    // An unknown or unreadable space is 404.
    expect((await view(w.ed.client, 'design', 'nowhere')).status).toBe(404);
    expect((await view(w.nm.client, 'design', 'red')).status).toBe(404);
  });

  it('hides trashed pages and spaces everywhere, brings them back on restore, and purge removes page labels', async () => {
    const parent = await makePage('alpha', 'Parent');
    const child = await makePage('alpha', 'Child budget', 'budget words', parent);
    const other = await makePage('beta', 'Beta budget', 'budget words');
    for (const id of [parent, child, other]) await add(w.ed.client, id, 'trashy');
    const count = async () => (await suggest(w.ed.client, 'trashy')).find((l) => l.name === 'trashy')?.count ?? 0;
    const everywhere = async () => ({
      wiki: (await viewTitles(w.ed.client, 'trashy')).sort(),
      alpha: (await viewTitles(w.ed.client, 'trashy', 'alpha')).sort(),
      search: titles(await search(w.ed.client, 'label=trashy')).sort(),
      count: await count(),
    });
    const all = { wiki: ['Beta budget', 'Child budget', 'Parent'], alpha: ['Child budget', 'Parent'], search: ['Beta budget', 'Child budget', 'Parent'], count: 3 };
    expect(await everywhere()).toEqual(all);

    // Trash the parent: it and its child leave every view, the count and search.
    expect((await w.ed.client.del(`/api/pages/${parent}`)).status).toBeLessThan(300);
    expect(await everywhere()).toEqual({ wiki: ['Beta budget'], alpha: [], search: ['Beta budget'], count: 1 });
    expect(titles(await search(w.ed.client, 'q=budget&label=trashy'))).toEqual(['Beta budget']);
    expect((await restore(parent)).status).toBe(200);
    expect(await everywhere()).toEqual(all);
    expect(names(await pageLabels(w.ed.client, child))).toEqual(['trashy']);

    // Trash the space beta: its pages are hidden the same way.
    expect((await w.sam.client.del('/api/spaces/beta')).status).toBe(204);
    expect(await everywhere()).toEqual({ wiki: ['Child budget', 'Parent'], alpha: ['Child budget', 'Parent'], search: ['Child budget', 'Parent'], count: 2 });
    const beta = await ctx.pool.query(`select id from spaces where key = 'beta'`);
    expect((await w.sam.client.post(`/api/trash/spaces/${beta.rows[0].id}/restore`)).status).toBe(200);
    expect(await everywhere()).toEqual(all);

    // Purge: the page_labels rows go, the labels row stays.
    await w.ed.client.del(`/api/pages/${other}`);
    expect((await w.sam.client.del(`/api/pages/${other}/purge`)).status).toBe(204);
    const left = await ctx.pool.query(`select count(*)::int as n from page_labels where page_id = $1`, [other]);
    expect(left.rows[0].n).toBe(0);
    const label = await ctx.pool.query(`select count(*)::int as n from labels where name = 'trashy'`);
    expect(label.rows[0].n).toBe(1);
    expect(await count()).toBe(2);
  });

  it('orders views newest change first, at most 200 with truncated, and suggestions prefix first, at most 50', async () => {
    // 201 pages with one label, straight through createPage and SQL to keep the test quick.
    const [space] = (await ctx.pool.query(`select id from spaces where key = 'alpha'`)).rows;
    const ids: string[] = [];
    for (let i = 0; i < 201; i++) ids.push(await createPage(ctx.db, { spaceId: space.id, userId: w.sam.user.id, title: `Bulk ${i}`, parentId: null }));
    await ctx.pool.query(`update pages set updated_at = now() - make_interval(secs => 1000 - n) from unnest($1::uuid[]) with ordinality as t(id, n) where pages.id = t.id`, [ids]);
    const label = (await add(w.sam.client, ids[0]!, 'bulk')).body.labels[0].id;
    await ctx.pool.query(`insert into page_labels (page_id, label_id) select unnest($1::uuid[]), $2 on conflict do nothing`, [ids, label]);
    for (const key of [undefined, 'alpha']) {
      const { body } = await view(w.ed.client, 'bulk', key);
      expect(body.pages).toHaveLength(200);
      expect(body.truncated).toBe(true);
      expect(body.pages[0].title).toBe('Bulk 200');
      expect(body.pages[199].title).toBe('Bulk 1');
    }

    // Prefix matches first, then by count, then by name.
    const pages = ids.slice(0, 5);
    const tag = async (name: string, n: number) => {
      for (const id of pages.slice(0, n)) await add(w.sam.client, id, name);
    };
    await tag('plan-a', 1);
    await tag('q4-plan', 3);
    await tag('replanned', 2);
    expect(names(await suggest(w.ed.client, 'plan'))).toEqual(['plan-a', 'q4-plan', 'replanned']);
    expect(names(await suggest(w.ed.client, 'Q4 Plan'))).toEqual(['q4-plan']);
    expect(names(await suggest(w.ed.client, '%'))).toEqual([]);
    expect((await suggest(w.ed.client))[0]).toEqual({ id: label, name: 'bulk', count: 201 });

    // At most 50.
    await ctx.pool.query(`insert into labels (name) select 'many-' || g from generate_series(1, 60) g`);
    await ctx.pool.query(`insert into page_labels (page_id, label_id) select $1, id from labels where name like 'many-%'`, [ids[10]]);
    expect(await suggest(w.ed.client, 'many')).toHaveLength(50);
    expect(await suggest(w.ed.client)).toHaveLength(50);
  });
});

describe('search by label', () => {
  it('filters through the one search query, by label= and by label: words', async () => {
    const plan = await makePage('alpha', 'Budget plan', 'The budget for next year');
    const loose = await makePage('alpha', 'Budget loose', 'Another budget');
    const notes = await makePage('beta', 'Design notes', 'Shapes and colours');
    const secret = await makePage('red', 'Secret budget', 'Hidden budget');
    const gone = await makePage('alpha', 'Gone budget', 'Old budget');
    await ageInOrder([notes, plan, loose, secret, gone]);
    for (const id of [plan, notes, secret, gone]) await add(w.sam.client, id, 'design');
    await add(w.sam.client, notes, 'q4-plans');
    await w.sam.client.del(`/api/pages/${gone}`);

    // Labels only: labelled pages Ed can see, newest change first.
    const only = await search(w.ed.client, 'label=design');
    expect(titles(only)).toEqual(['Budget plan', 'Design notes']);
    expect(only[1]!.labels.map((l) => l.name)).toEqual(['design', 'q4-plans']);
    // Words and a label: both needed.
    expect(titles(await search(w.ed.client, 'q=budget&label=design'))).toEqual(['Budget plan']);
    // Two labels: both needed.
    expect(titles(await search(w.ed.client, 'label=design&label=q4-plans'))).toEqual(['Design notes']);
    // label: words in the box give the same.
    expect(titles(await search(w.ed.client, `q=${encodeURIComponent('label:design budget')}`))).toEqual(['Budget plan']);
    expect(titles(await search(w.ed.client, `q=${encodeURIComponent('budget Label:Design')}`))).toEqual(['Budget plan']);
    expect(titles(await search(w.ed.client, `q=${encodeURIComponent('label:design label:q4-plans')}`))).toEqual(['Design notes']);
    // Plain search still works and now carries labels.
    const plain = await search(w.ed.client, 'q=budget');
    expect(titles(plain).sort()).toEqual(['Budget loose', 'Budget plan']);
    expect(plain.find((r) => r.title === 'Budget loose')!.labels).toEqual([]);
    // The restricted page shows for its member only; the trashed one for nobody.
    expect(titles(await search(w.ro.client, 'q=budget&label=design')).sort()).toEqual(['Budget plan', 'Secret budget']);
    expect(titles(await search(w.ada.client, 'label=design'))).not.toContain('Gone budget');
    // A bad or unused label finds nothing; a bare "label:" is ignored.
    expect(await search(w.ed.client, 'label=a.b')).toEqual([]);
    expect(await search(w.ed.client, `q=${encodeURIComponent('budget label:a/b')}`)).toEqual([]);
    expect(await search(w.ed.client, 'label=never-used')).toEqual([]);
    expect(titles(await search(w.ed.client, `q=${encodeURIComponent('label: budget')}`)).sort()).toEqual(['Budget loose', 'Budget plan']);
    expect(await search(w.ed.client, `q=${encodeURIComponent('label:')}`)).toEqual([]);
  });
});

it('answers 401 on every label route when signed out', async () => {
  const page = await makePage('alpha', 'Any');
  const out = new Client(ctx.app);
  const id = '00000000-0000-4000-8000-000000000000';
  for (const [method, url] of [
    ['POST', `/api/pages/${page}/labels`],
    ['DELETE', `/api/pages/${page}/labels/${id}`],
    ['GET', '/api/labels'],
    ['GET', '/api/labels/design/pages'],
    ['GET', '/api/spaces/alpha/labels/design/pages'],
    ['GET', `/api/pages/${page}`],
    ['GET', '/api/search?label=design'],
  ] as const) {
    expect((await out.req(method, url, method === 'POST' ? { name: 'x' } : undefined)).status, `${method} ${url}`).toBe(401);
  }
});

async function restore(pageId: string) {
  return w.ed.client.post(`/api/pages/${pageId}/restore`);
}
