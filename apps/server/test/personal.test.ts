// Favourites and recently viewed, server side
// (docs/done-checks/09-favourites-recent.md, "9a — Server"): the two tables,
// the favourite and viewed routes and the two personal lists, all against
// real Postgres.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'stillwater-personal-'));
let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setupApp({ UPLOAD_DIR: uploadDir });
  await ctx.reset();
});
afterEach(() => ctx.close());
afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

async function makeSpace(c: Client, key: string, name: string, visibility: 'open' | 'restricted' = 'open') {
  expect((await c.post('/api/spaces', { key, name, visibility })).status).toBe(201);
}

async function makePage(c: Client, key: string, title: string): Promise<string> {
  const res = await c.post(`/api/spaces/${key}/pages`, { title, parentId: null });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.page.id as string;
}

async function setRole(admin: Client, key: string, userId: string, role: 'viewer' | 'editor' | 'admin') {
  expect((await admin.put(`/api/spaces/${key}/members/${userId}`, { role })).status).toBe(200);
}

const favourites = async (c: Client) => {
  const res = await c.get('/api/me/favourites');
  expect(res.status).toBe(200);
  return res.body.pages as { id: string; title: string; space: { key: string; name: string }; favouritedAt: string }[];
};

const recent = async (c: Client) => {
  const res = await c.get('/api/me/recent');
  expect(res.status).toBe(200);
  return res.body.pages as { id: string; title: string; space: { key: string; name: string }; viewedAt: string }[];
};

const star = async (c: Client, id: string) => (await c.put(`/api/pages/${id}/favourite`)).status;
const unstar = async (c: Client, id: string) => (await c.del(`/api/pages/${id}/favourite`)).status;
const viewed = async (c: Client, id: string) => (await c.post(`/api/pages/${id}/viewed`)).status;

const count = async (table: 'page_favourites' | 'page_views', where = 'true', args: unknown[] = []) =>
  (await ctx.pool.query(`select count(*)::int as n from ${table} where ${where}`, args)).rows[0].n as number;

/** Ada is the instance admin (first sign-up); Bea is an editor. Two open spaces. */
async function twoSpaces() {
  const ada = await signup(ctx.app, 'Ada');
  const bea = await signup(ctx.app, 'Bea');
  await makeSpace(ada.client, 'eng', 'Engineering');
  await makeSpace(ada.client, 'ops', 'Operations');
  await setRole(ada.client, 'eng', bea.user.id, 'editor');
  await setRole(ada.client, 'ops', bea.user.id, 'editor');
  const a = await makePage(ada.client, 'eng', 'Runbook');
  const b = await makePage(ada.client, 'ops', 'On call');
  const c = await makePage(ada.client, 'eng', 'Third');
  return { ada, bea, a, b, c };
}

describe('favourites', () => {
  it('an editor favourites two pages in two spaces: listed newest first; the page says favourite', async () => {
    const { bea, a, b, c } = await twoSpaces();
    expect(await star(bea.client, a)).toBe(204);
    expect(await star(bea.client, b)).toBe(204);

    const list = await favourites(bea.client);
    expect(list.map((p) => p.id)).toEqual([b, a]);
    expect(list[0]).toMatchObject({ id: b, title: 'On call', space: { key: 'ops', name: 'Operations' } });
    expect(list[1]).toMatchObject({ id: a, title: 'Runbook', space: { key: 'eng', name: 'Engineering' } });
    expect(Object.keys(list[0]!).sort()).toEqual(['favouritedAt', 'id', 'space', 'title']);
    expect(Number.isNaN(Date.parse(list[0]!.favouritedAt))).toBe(false);

    expect((await bea.client.get(`/api/pages/${a}`)).body.page.favourite).toBe(true);
    expect((await bea.client.get(`/api/pages/${b}`)).body.page.favourite).toBe(true);
    expect((await bea.client.get(`/api/pages/${c}`)).body.page.favourite).toBe(false);
  });

  it('PUT twice is one row; DELETE removes it; DELETE again is still 204', async () => {
    const { bea, a } = await twoSpaces();
    expect(await star(bea.client, a)).toBe(204);
    expect(await star(bea.client, a)).toBe(204);
    expect(await count('page_favourites', 'user_id = $1', [bea.user.id])).toBe(1);
    expect((await favourites(bea.client)).map((p) => p.id)).toEqual([a]);

    expect(await unstar(bea.client, a)).toBe(204);
    expect(await favourites(bea.client)).toEqual([]);
    expect((await bea.client.get(`/api/pages/${a}`)).body.page.favourite).toBe(false);
    expect(await unstar(bea.client, a)).toBe(204);
  });

  it('a viewer can favourite and record views; the page version and updated_at do not change', async () => {
    const { ada, a } = await twoSpaces();
    const val = await signup(ctx.app, 'Val');
    await setRole(ada.client, 'eng', val.user.id, 'viewer');
    const before = (await ctx.pool.query('select version, updated_at from pages where id = $1', [a])).rows[0];

    expect(await star(val.client, a)).toBe(204);
    expect(await viewed(val.client, a)).toBe(204);
    expect((await favourites(val.client)).map((p) => p.id)).toEqual([a]);
    expect((await recent(val.client)).map((p) => p.id)).toEqual([a]);

    const after = (await ctx.pool.query('select version, updated_at from pages where id = $1', [a])).rows[0];
    expect(after.version).toBe(before.version);
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
    const history = (await ctx.pool.query('select count(*)::int as n from page_versions where page_id = $1', [a])).rows[0].n;
    expect(history).toBe(1);
  });

  it("another person's lists never show in yours, and an admin's lists hold only the admin's own", async () => {
    const { ada, bea, a, b, c } = await twoSpaces();
    expect(await star(bea.client, a)).toBe(204);
    expect(await viewed(bea.client, a)).toBe(204);
    expect(await star(ada.client, b)).toBe(204);
    expect(await viewed(ada.client, c)).toBe(204);

    expect((await favourites(bea.client)).map((p) => p.id)).toEqual([a]);
    expect((await recent(bea.client)).map((p) => p.id)).toEqual([a]);
    expect((await favourites(ada.client)).map((p) => p.id)).toEqual([b]);
    expect((await recent(ada.client)).map((p) => p.id)).toEqual([c]);
    // The page flag is per person too.
    expect((await ada.client.get(`/api/pages/${a}`)).body.page.favourite).toBe(false);
  });
});

describe('recently viewed', () => {
  it('A, B, A lists A then B, one row each', async () => {
    const { bea, a, b } = await twoSpaces();
    for (const id of [a, b, a]) expect(await viewed(bea.client, id)).toBe(204);
    const list = await recent(bea.client);
    expect(list.map((p) => p.id)).toEqual([a, b]);
    expect(list[0]).toMatchObject({ title: 'Runbook', space: { key: 'eng', name: 'Engineering' } });
    expect(Object.keys(list[0]!).sort()).toEqual(['id', 'space', 'title', 'viewedAt']);
    expect(await count('page_views', 'user_id = $1', [bea.user.id])).toBe(2);
  });

  it('55 views on 55 pages keep 50 rows and list the newest 20', async () => {
    const ada = await signup(ctx.app, 'Ada');
    await makeSpace(ada.client, 'big', 'Big space');
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) ids.push(await makePage(ada.client, 'big', `Page ${i}`));
    for (const id of ids) expect(await viewed(ada.client, id)).toBe(204);

    expect(await count('page_views', 'user_id = $1', [ada.user.id])).toBe(50);
    const kept = (await ctx.pool.query('select page_id from page_views where user_id = $1', [ada.user.id])).rows.map(
      (r) => r.page_id,
    );
    expect(new Set(kept)).toEqual(new Set(ids.slice(5)));
    const list = await recent(ada.client);
    expect(list.map((p) => p.id)).toEqual(ids.slice(35).reverse());
  });

  it('GET /api/pages/:id on its own does not add a view', async () => {
    const { bea, a } = await twoSpaces();
    expect((await bea.client.get(`/api/pages/${a}`)).status).toBe(200);
    expect(await count('page_views')).toBe(0);
    expect(await recent(bea.client)).toEqual([]);
  });
});

describe('who can see what', () => {
  it('non-members get 404; a removed member loses the page from both lists, and gets it back when re-added', async () => {
    const ada = await signup(ctx.app, 'Ada');
    const bea = await signup(ctx.app, 'Bea');
    const nia = await signup(ctx.app, 'Nia');
    await makeSpace(ada.client, 'sec', 'Security', 'restricted');
    await setRole(ada.client, 'sec', bea.user.id, 'editor');
    const p = await makePage(ada.client, 'sec', 'Keys');

    expect(await star(nia.client, p)).toBe(404);
    expect(await unstar(nia.client, p)).toBe(404);
    expect(await viewed(nia.client, p)).toBe(404);
    expect(await count('page_favourites', 'user_id = $1', [nia.user.id])).toBe(0);
    expect(await count('page_views', 'user_id = $1', [nia.user.id])).toBe(0);

    expect(await star(bea.client, p)).toBe(204);
    expect(await viewed(bea.client, p)).toBe(204);
    expect((await favourites(bea.client)).map((x) => x.id)).toEqual([p]);

    expect((await ada.client.del(`/api/spaces/sec/members/${bea.user.id}`)).status).toBeLessThan(300);
    expect(await favourites(bea.client)).toEqual([]);
    expect(await recent(bea.client)).toEqual([]);
    expect(await star(bea.client, p)).toBe(404);

    await setRole(ada.client, 'sec', bea.user.id, 'viewer');
    expect((await favourites(bea.client)).map((x) => x.id)).toEqual([p]);
    expect((await recent(bea.client)).map((x) => x.id)).toEqual([p]);
  });

  it('a soft-deleted page drops out of both lists and its routes give 404; deleting the space removes the rows', async () => {
    const { ada, bea, a, c } = await twoSpaces();
    for (const id of [a, c]) {
      expect(await star(bea.client, id)).toBe(204);
      expect(await viewed(bea.client, id)).toBe(204);
    }
    expect((await ada.client.del(`/api/pages/${a}`)).status).toBe(200);
    expect((await favourites(bea.client)).map((x) => x.id)).toEqual([c]);
    expect((await recent(bea.client)).map((x) => x.id)).toEqual([c]);
    expect(await star(bea.client, a)).toBe(404);
    expect(await unstar(bea.client, a)).toBe(404);
    expect(await viewed(bea.client, a)).toBe(404);

    const unknown = '00000000-0000-4000-8000-000000000000';
    expect(await star(bea.client, unknown)).toBe(404);
    expect(await viewed(bea.client, unknown)).toBe(404);
    expect(await star(bea.client, 'not-a-uuid')).toBe(404);

    expect(await count('page_favourites')).toBe(2);
    expect(await count('page_views')).toBe(2);
    expect((await ada.client.del('/api/spaces/eng')).status).toBeLessThan(300);
    expect(await count('page_favourites')).toBe(0);
    expect(await count('page_views')).toBe(0);
  });

  it("deleting a user removes that user's rows", async () => {
    const { ada, bea, a, b } = await twoSpaces();
    expect(await star(bea.client, a)).toBe(204);
    expect(await viewed(bea.client, b)).toBe(204);
    expect(await star(ada.client, a)).toBe(204);
    await ctx.pool.query('delete from users where id = $1', [bea.user.id]);
    expect(await count('page_favourites', 'user_id = $1', [bea.user.id])).toBe(0);
    expect(await count('page_views', 'user_id = $1', [bea.user.id])).toBe(0);
    expect(await count('page_favourites')).toBe(1);
  });
});

describe('input and sign-in', () => {
  it('a page title that looks like HTML comes back as the same text', async () => {
    const ada = await signup(ctx.app, 'Ada');
    await makeSpace(ada.client, 'eng', 'Engineering');
    const title = '<img src=x onerror=alert(1)>';
    const p = await makePage(ada.client, 'eng', title);
    expect(await star(ada.client, p)).toBe(204);
    expect(await viewed(ada.client, p)).toBe(204);
    expect((await favourites(ada.client))[0]!.title).toBe(title);
    expect((await recent(ada.client))[0]!.title).toBe(title);
  });

  it('bodies with unknown fields are refused', async () => {
    const { bea, a } = await twoSpaces();
    expect((await bea.client.put(`/api/pages/${a}/favourite`, { pin: true })).status).toBe(400);
    expect((await bea.client.req('DELETE', `/api/pages/${a}/favourite`, { x: 1 })).status).toBe(400);
    expect((await bea.client.post(`/api/pages/${a}/viewed`, { at: '2020-01-01' })).status).toBe(400);
    expect(await count('page_favourites')).toBe(0);
    expect(await count('page_views')).toBe(0);
  });

  it('signed out is 401 on every route', async () => {
    const { a } = await twoSpaces();
    const anon = new Client(ctx.app);
    expect((await anon.put(`/api/pages/${a}/favourite`)).status).toBe(401);
    expect((await anon.del(`/api/pages/${a}/favourite`)).status).toBe(401);
    expect((await anon.post(`/api/pages/${a}/viewed`)).status).toBe(401);
    expect((await anon.get('/api/me/favourites')).status).toBe(401);
    expect((await anon.get('/api/me/recent')).status).toBe(401);
  });
});
