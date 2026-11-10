// Trash, server side (docs/done-checks/11-trash.md, "11a — Server"): one item
// per delete, restore and purge, the timed purge, trashed spaces, the back-fill
// in migration 0007_trash, and who may do what. Real Postgres.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';
import { purgeExpired } from '../src/trash/trash.js';
import { trashRetentionDays } from '../src/env.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'stillwater-trash-'));
const DAY = 24 * 60 * 60 * 1000;
let ctx: TestCtx;
let w: Awaited<ReturnType<typeof world>>;

// Signups are rate-limited per address, so the people are made once for the file.
beforeAll(async () => {
  ctx = await setupApp({ UPLOAD_DIR: uploadDir, AI_PROVIDER: 'stub' });
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

async function upload(app: FastifyInstance, c: Client, pageId: string, data = PNG) {
  const boundary = '----stillwater' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dot.png"\r\nContent-Type: image/png\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: `/api/pages/${pageId}/attachments`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: c.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const docOf = (...texts: string[]) => ({ type: 'doc', content: texts.map(p) });

async function makePage(c: Client, title: string, parentId: string | null = null, text?: string, key = 'eng') {
  const res = await c.post(`/api/spaces/${key}/pages`, { title, parentId });
  expect(res.status).toBe(201);
  const id = res.body.page.id as string;
  if (text) expect((await c.put(`/api/pages/${id}`, { baseVersion: 1, doc: docOf(text) })).status).toBe(200);
  return id;
}

/**
 * Ada is the instance admin. Sam makes the restricted space "eng" and is its
 * space admin; Ed is an editor member, Vi a viewer member, Nm is signed in but
 * not a member.
 */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const sam = await signup(ctx.app, 'Sam');
  const ed = await signup(ctx.app, 'Ed');
  const vi = await signup(ctx.app, 'Vi');
  const nm = await signup(ctx.app, 'Nm');
  expect((await sam.client.post('/api/spaces', { key: 'eng', name: 'Engineering', visibility: 'restricted' })).status).toBe(201);
  await sam.client.put(`/api/spaces/eng/members/${ed.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${vi.user.id}`, { role: 'viewer' });
  return { ada, sam, ed, vi, nm };
}

const trashList = async (c: Client, key = 'eng') => {
  const res = await c.get(`/api/spaces/${key}/trash`);
  expect(res.status).toBe(200);
  return res.body as {
    retentionDays: number;
    items: { id: string; title: string; deletedAt: string; deletedBy: { id: string; name: string } | null; subPages: number; purgeAt: string | null }[];
  };
};
const tree = async (c: Client, key = 'eng') => (await c.get(`/api/spaces/${key}/pages`)).body.pages as { id: string; parentId: string | null; position: string }[];
const searchIds = async (c: Client, q: string) => ((await c.get(`/api/search?q=${q}`)).body.results as { pageId: string }[]).map((r) => r.pageId);
const askIds = async (c: Client, q: string) => ((await c.post('/api/ai/ask', { question: q })).body.sources as { pageId: string }[]).map((s) => s.pageId);
const favIds = async (c: Client) => ((await c.get('/api/me/favourites')).body.pages as { id: string }[]).map((x) => x.id);
const recentIds = async (c: Client) => ((await c.get('/api/me/recent')).body.pages as { id: string }[]).map((x) => x.id);
const storedBytes = async (key: string) => {
  const s = await ctx.app.storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
};
/** What trash must never change: the document, its version, the co-editing state and the history rows. */
const docState = async (ids: string[]) => {
  const pages = await ctx.pool.query('select id, doc, version, ydoc_state, title from pages where id = any($1) order by id', [ids]);
  const versions = await ctx.pool.query('select * from page_versions where page_id = any($1) order by page_id, version', [ids]);
  return { pages: pages.rows, versions: versions.rows };
};
const noLiveUnderTrashed = async () => {
  const res = await ctx.pool.query(
    'select count(*)::int as n from pages c join pages p on p.id = c.parent_id where c.deleted_at is null and p.deleted_at is not null',
  );
  expect(res.rows[0].n).toBe(0);
};

describe('trash: pages', () => {
  it('an editor deletes a page with its sub-pages, history, comments and file; it is one item, hidden everywhere, and restore brings it all back unchanged', async () => {
    const { sam, ed, vi } = w;
    const parent = await makePage(ed.client, 'Handbook');
    const before1 = await makePage(ed.client, 'Before', parent);
    const root = await makePage(ed.client, 'Runbook', parent);
    const after1 = await makePage(ed.client, 'After', parent);
    const child = await makePage(ed.client, 'Deploys', root);
    const grandchild = await makePage(ed.client, 'Rollback', child, 'Quillwort is the rollback switch.');
    // Three versions: authors take turns so no save is folded into the last.
    expect((await sam.client.put(`/api/pages/${root}`, { baseVersion: 1, doc: docOf('Mossbank runbook.') })).status).toBe(200);
    expect((await ed.client.put(`/api/pages/${root}`, { baseVersion: 2, doc: docOf('Mossbank runbook, second draft.') })).status).toBe(200);
    expect((await ed.client.get(`/api/pages/${root}/versions`)).body.versions).toHaveLength(3);
    expect((await ed.client.post(`/api/pages/${root}/comments`, { body: 'First thread' })).status).toBe(201);
    expect((await sam.client.post(`/api/pages/${root}/comments`, { body: 'Second thread' })).status).toBe(201);
    const file = await upload(ctx.app, ed.client, root);
    expect((await vi.client.put(`/api/pages/${child}/favourite`)).status).toBe(204);
    expect((await vi.client.post(`/api/pages/${root}/viewed`)).status).toBe(204);

    const treeBefore = await tree(ed.client);
    const commentsBefore = (await ed.client.get(`/api/pages/${root}/comments`)).body;
    expect(commentsBefore.threads).toHaveLength(2);
    const stateBefore = await docState([root, child, grandchild]);
    expect(await searchIds(vi.client, 'quillwort')).toEqual([grandchild]);
    expect(await askIds(vi.client, 'quillwort rollback switch')).toContain(grandchild);
    expect(await favIds(vi.client)).toContain(child);
    expect(await recentIds(vi.client)).toContain(root);

    const del = await ed.client.del(`/api/pages/${root}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(3);

    const list = await trashList(ed.client);
    expect(list.retentionDays).toBe(30);
    const items = list.items.filter((i) => [root, child, grandchild].includes(i.id));
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item).toMatchObject({ id: root, title: 'Runbook', subPages: 2, deletedBy: { id: ed.user.id, name: 'Ed' } });
    expect(new Date(item.purgeAt!).getTime() - new Date(item.deletedAt).getTime()).toBe(30 * DAY);

    // In the trash: gone from every reader's view.
    for (const c of [ed.client, vi.client]) {
      expect((await c.get(`/api/pages/${root}`)).status).toBe(404);
      expect((await c.get(`/api/pages/${child}`)).status).toBe(404);
      expect((await c.get(`/api/pages/${root}/comments`)).status).toBe(404);
      expect((await c.get(`/api/pages/${root}/versions`)).status).toBe(404);
      expect((await c.get(`/api/attachments/${file}`)).status).toBe(404);
    }
    // Editors are told it is in the trash (the screen links to Trash); viewers only get "not found".
    expect((await ed.client.get(`/api/pages/${root}`)).body.error).toBe('in_trash');
    expect((await ed.client.get(`/api/pages/${child}`)).body.error).toBe('in_trash');
    expect((await vi.client.get(`/api/pages/${root}`)).body.error).toBe('not_found');
    expect((await w.nm.client.get(`/api/pages/${root}`)).body.error).toBe('not_found');
    expect((await tree(ed.client)).map((x) => x.id)).not.toContain(root);
    expect(await searchIds(vi.client, 'quillwort')).toEqual([]);
    expect(await askIds(vi.client, 'quillwort rollback switch')).not.toContain(grandchild);
    expect(await favIds(vi.client)).not.toContain(child);
    expect(await recentIds(vi.client)).not.toContain(root);
    // The bytes are kept while it is in the trash.
    expect((await storedBytes(file))!.equals(PNG)).toBe(true);

    const restored = await ed.client.post(`/api/pages/${root}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ page: { id: root, parentId: parent, title: 'Runbook' } });

    // Same ids, same parent, same place; document, version and history untouched.
    expect(await tree(ed.client)).toEqual(treeBefore);
    const order = (await tree(ed.client)).filter((x) => x.parentId === parent).map((x) => x.id);
    expect(order).toEqual([before1, root, after1]);
    expect(await docState([root, child, grandchild])).toEqual(stateBefore);
    expect((await ed.client.get(`/api/pages/${root}/versions`)).body.versions).toHaveLength(3);
    expect((await ed.client.get(`/api/pages/${root}`)).body.page.version).toBe(3);
    expect((await ed.client.get(`/api/pages/${root}/comments`)).body).toEqual(commentsBefore);
    const got = await vi.client.get(`/api/attachments/${file}`);
    expect(got.status).toBe(200);
    expect(got.raw.rawPayload.equals(PNG)).toBe(true);
    expect(await searchIds(vi.client, 'quillwort')).toEqual([grandchild]);
    expect(await askIds(vi.client, 'quillwort rollback switch')).toContain(grandchild);
    expect(await favIds(vi.client)).toContain(child);
    expect(await recentIds(vi.client)).toContain(root);
    expect((await trashList(ed.client)).items.map((i) => i.id)).not.toContain(root);
    const flags = await ctx.pool.query('select deleted_at, deleted_by, trash_root_id from pages where id = any($1)', [[root, child, grandchild]]);
    expect(flags.rows.every((r) => r.deleted_at === null && r.deleted_by === null && r.trash_root_id === null)).toBe(true);
  });

  it('a sub-page deleted on its own first stays its own item when the parent is deleted and restored', async () => {
    const { ed } = w;
    const a = await makePage(ed.client, 'Alpha');
    const b = await makePage(ed.client, 'Beta', a);
    expect((await ed.client.del(`/api/pages/${b}`)).body.deleted).toBe(1);
    expect((await ed.client.del(`/api/pages/${a}`)).body.deleted).toBe(1);
    const items = (await trashList(ed.client)).items.filter((i) => i.id === a || i.id === b);
    expect(items.map((i) => [i.id, i.subPages])).toEqual([
      [a, 0],
      [b, 0],
    ]);
    expect((await ed.client.post(`/api/pages/${a}/restore`)).status).toBe(200);
    expect((await ed.client.get(`/api/pages/${b}`)).status).toBe(404);
    expect((await trashList(ed.client)).items.map((i) => i.id)).toContain(b);
    // Restoring a live page: 400.
    expect((await ed.client.post(`/api/pages/${a}/restore`)).status).toBe(400);

    const back = await ed.client.post(`/api/pages/${b}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.page).toEqual({ id: b, parentId: a, title: 'Beta' });
    expect((await ed.client.get(`/api/pages/${b}`)).body.page.parentId).toBe(a);
    expect((await ed.client.post(`/api/pages/00000000-0000-4000-8000-000000000000/restore`)).status).toBe(404);
    await noLiveUnderTrashed();
  });

  it('restoring a page whose parent is still in the trash puts it at the top level', async () => {
    const { ed } = w;
    const x = await makePage(ed.client, 'Xenon');
    const y = await makePage(ed.client, 'Yttrium', x);
    const z = await makePage(ed.client, 'Zinc', y);
    await ed.client.del(`/api/pages/${y}`);
    await ed.client.del(`/api/pages/${x}`);
    // Zinc went with Yttrium, so it is not a root of its own: 400.
    expect((await ed.client.post(`/api/pages/${z}/restore`)).status).toBe(400);
    const res = await ed.client.post(`/api/pages/${y}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.page.parentId).toBeNull();
    const t = await tree(ed.client);
    expect(t.find((n) => n.id === y)!.parentId).toBeNull();
    expect(t.find((n) => n.id === z)!.parentId).toBe(y);
    expect(t.map((n) => n.id)).not.toContain(x);
    await noLiveUnderTrashed();
    // Its old key (first under Xenon) is taken at the top level, so it goes at the end.
    const top = t.filter((n) => n.parentId === null);
    expect(new Set(top.map((n) => n.position)).size).toBe(top.length);
    expect(top.at(-1)!.id).toBe(y);
  });

  it('viewers cannot use the trash, editors cannot purge, non-members get 404', async () => {
    const { ed, vi, nm } = w;
    const live = await makePage(ed.client, 'Live page');
    const gone = await makePage(ed.client, 'Gone page');
    await ed.client.del(`/api/pages/${gone}`);

    expect((await vi.client.get('/api/spaces/eng/trash')).status).toBe(403);
    expect((await vi.client.post(`/api/pages/${gone}/restore`)).status).toBe(403);
    expect((await vi.client.del(`/api/pages/${gone}/purge`)).status).toBe(403);
    expect((await vi.client.del('/api/spaces/eng/trash')).status).toBe(403);
    expect((await vi.client.del(`/api/pages/${live}`)).status).toBe(403);

    expect((await ed.client.del(`/api/pages/${gone}/purge`)).status).toBe(403);
    expect((await ed.client.del('/api/spaces/eng/trash')).status).toBe(403);
    expect((await ed.client.del('/api/spaces/eng')).status).toBe(403);

    expect((await nm.client.get('/api/spaces/eng/trash')).status).toBe(404);
    expect((await nm.client.del('/api/spaces/eng/trash')).status).toBe(404);
    expect((await nm.client.post(`/api/pages/${gone}/restore`)).status).toBe(404);
    expect((await nm.client.del(`/api/pages/${gone}/purge`)).status).toBe(404);
    expect((await nm.client.del(`/api/pages/${live}`)).status).toBe(404);
    expect((await nm.client.del('/api/spaces/eng')).status).toBe(404);

    // Nothing was changed by any of that.
    expect((await trashList(ed.client)).items.map((i) => i.id)).toContain(gone);
    expect((await ed.client.get(`/api/pages/${live}`)).status).toBe(200);
  });

  it('a space admin purges an item for good, rows and file bytes; empty trash purges every item', async () => {
    const { sam, ed } = w;
    const q = await makePage(ed.client, 'Quartz');
    const q2 = await makePage(ed.client, 'Quartz notes', q, 'Some notes.');
    expect((await ed.client.post(`/api/pages/${q}/comments`, { body: 'A comment' })).status).toBe(201);
    const file = await upload(ctx.app, ed.client, q2);
    expect((await sam.client.del(`/api/pages/${q}/purge`)).status).toBe(400);
    await ed.client.del(`/api/pages/${q}`);
    // Not a root: 400.
    const notRoot = await sam.client.del(`/api/pages/${q2}/purge`);
    expect(notRoot.status).toBe(400);

    const purge = await sam.client.del(`/api/pages/${q}/purge`);
    expect(purge.status).toBe(204);
    const ids = [q, q2];
    for (const table of ['pages where id', 'page_versions where page_id', 'page_comments where page_id', 'attachments where page_id']) {
      const res = await ctx.pool.query(`select count(*)::int as n from ${table} = any($1)`, [ids]);
      expect(res.rows[0].n, table).toBe(0);
    }
    expect(await storedBytes(file)).toBeNull();
    expect(readdirSync(uploadDir)).not.toContain(file);
    expect((await sam.client.del(`/api/pages/${q}/purge`)).status).toBe(404);
    expect((await sam.client.post(`/api/pages/${q}/restore`)).status).toBe(404);

    // Empty the trash: two fresh items plus whatever earlier tests left there.
    const e1 = await makePage(ed.client, 'Empty me 1');
    const e1c = await makePage(ed.client, 'Empty me 1 child', e1);
    const e2 = await makePage(ed.client, 'Empty me 2');
    const f2 = await upload(ctx.app, ed.client, e1c);
    await ed.client.del(`/api/pages/${e1}`);
    await ed.client.del(`/api/pages/${e2}`);
    const before = await trashList(sam.client);
    expect(before.items.length).toBeGreaterThanOrEqual(2);
    const emptied = await sam.client.del('/api/spaces/eng/trash');
    expect(emptied.status).toBe(200);
    expect(emptied.body).toEqual({ purged: before.items.length });
    expect((await trashList(sam.client)).items).toEqual([]);
    expect(await storedBytes(f2)).toBeNull();
    const left = await ctx.pool.query(
      "select count(*)::int as n from pages where space_id = (select id from spaces where key = 'eng') and deleted_at is not null",
    );
    expect(left.rows[0].n).toBe(0);
    expect((await sam.client.del('/api/spaces/eng/trash')).body).toEqual({ purged: 0 });
  });

  it('purgeExpired keeps an item for 30 days, then deletes it and its file; 0 days means never', async () => {
    const { ed } = w;
    const e = await makePage(ed.client, 'Expiring');
    const file = await upload(ctx.app, ed.client, e);
    await ed.client.del(`/api/pages/${e}`);
    const { rows } = await ctx.pool.query('select deleted_at from pages where id = $1', [e]);
    const at = (rows[0].deleted_at as Date).getTime();

    // The default comes from TRASH_RETENTION_DAYS, unset here, so 30.
    await purgeExpired(ctx.db, ctx.app.storage, new Date(at + 29 * DAY));
    expect((await trashList(ed.client)).items.map((i) => i.id)).toContain(e);
    expect(await storedBytes(file)).not.toBeNull();
    await purgeExpired(ctx.db, ctx.app.storage, new Date(at + 1000 * DAY), 0);
    expect((await trashList(ed.client)).items.map((i) => i.id)).toContain(e);

    const out = await purgeExpired(ctx.db, ctx.app.storage, new Date(at + 31 * DAY), 30);
    expect(out.pages).toBeGreaterThanOrEqual(1);
    expect((await ctx.pool.query('select 1 from pages where id = $1', [e])).rowCount).toBe(0);
    expect(await storedBytes(file)).toBeNull();
  });

  it('with TRASH_RETENTION_DAYS=0 the trash list has no purge date', async () => {
    const zero = await setupApp({ UPLOAD_DIR: uploadDir, TRASH_RETENTION_DAYS: '0' });
    try {
      const zed = await signup(zero.app, 'Zed', 'zed@example.com');
      expect((await zed.client.post('/api/spaces', { key: 'zero', name: 'Zero' })).status).toBe(201);
      const id = await makePage(zed.client, 'Kept', null, undefined, 'zero');
      await zed.client.del(`/api/pages/${id}`);
      const list = await trashList(zed.client, 'zero');
      expect(list.retentionDays).toBe(0);
      expect(list.items).toEqual([expect.objectContaining({ id, purgeAt: null })]);
      expect((await zed.client.get('/api/trash/spaces')).body).toEqual({ items: [] });
    } finally {
      await zero.close();
    }
  });

  it('TRASH_RETENTION_DAYS must be a whole number of days, 0 or more', () => {
    expect(trashRetentionDays(undefined)).toBe(30);
    expect(trashRetentionDays(' ')).toBe(30);
    expect(trashRetentionDays('0')).toBe(0);
    expect(trashRetentionDays(' 7 ')).toBe(7);
    for (const bad of ['-1', '1.5', 'abc', '30d', '1e3']) {
      expect(() => trashRetentionDays(bad), bad).toThrow(/TRASH_RETENTION_DAYS must be a whole number of days/);
    }
  });

  it('the hourly sweep starts with the app and stops when it closes', async () => {
    const swept = await setupApp({ UPLOAD_DIR: uploadDir }, { trashSweep: true });
    expect((await swept.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await swept.close();
  });
});

describe('trash: spaces', () => {
  it('a space admin moves a space to the trash; it is hidden, its key stays taken, and restore and purge work by id', async () => {
    const { ada, sam, ed, vi, nm } = w;
    expect((await sam.client.post('/api/spaces', { key: 'ops', name: 'Operations', visibility: 'restricted' })).status).toBe(201);
    await sam.client.put(`/api/spaces/ops/members/${ed.user.id}`, { role: 'editor' });
    await sam.client.put(`/api/spaces/ops/members/${vi.user.id}`, { role: 'viewer' });
    const o1 = await makePage(ed.client, 'Pager', null, 'Zanthoxyl is the pager rota.', 'ops');
    const o2 = await makePage(ed.client, 'Pager notes', o1, undefined, 'ops');
    const o3 = await makePage(ed.client, 'Old page', null, undefined, 'ops');
    await ed.client.del(`/api/pages/${o3}`);
    const file = await upload(ctx.app, ed.client, o2);
    expect((await ed.client.post('/api/spaces/ops/templates', { name: 'Incident', doc: docOf('What happened.') })).status).toBe(201);
    const spaceId = (await sam.client.get('/api/spaces/ops')).body.space.id as string;

    const snapshot = async () => ({
      pages: await tree(sam.client, 'ops'),
      trash: (await trashList(sam.client, 'ops')).items,
      members: (await sam.client.get('/api/spaces/ops/members')).body,
      templates: (await sam.client.get('/api/spaces/ops/templates')).body,
      space: (await sam.client.get('/api/spaces/ops')).body,
    });
    const before = await snapshot();
    expect(before.trash.map((i) => i.id)).toEqual([o3]);
    expect(await searchIds(vi.client, 'zanthoxyl')).toEqual([o1]);
    expect(await askIds(vi.client, 'zanthoxyl pager rota')).toContain(o1);

    expect((await ed.client.del('/api/spaces/ops')).status).toBe(403);
    expect((await sam.client.del('/api/spaces/ops')).status).toBe(204);

    for (const c of [sam.client, ada.client, vi.client]) {
      expect(((await c.get('/api/spaces')).body.spaces as { key: string }[]).map((s) => s.key)).not.toContain('ops');
      expect((await c.get('/api/spaces/ops')).status).toBe(404);
      expect((await c.get(`/api/pages/${o1}`)).status).toBe(404);
      expect((await c.get(`/api/pages/${o2}`)).status).toBe(404);
      expect((await c.get(`/api/attachments/${file}`)).status).toBe(404);
      expect((await c.get('/api/spaces/ops/trash')).status).toBe(404);
    }
    expect(await searchIds(vi.client, 'zanthoxyl')).toEqual([]);
    expect(await searchIds(ada.client, 'zanthoxyl')).toEqual([]);
    expect(await askIds(ada.client, 'zanthoxyl pager rota')).not.toContain(o1);
    expect((await sam.client.post(`/api/pages/${o3}/restore`)).status).toBe(404);

    const again = await ed.client.post('/api/spaces', { key: 'ops', name: 'Ops again' });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('A space in the trash uses this key');

    const listed = async (c: Client) => ((await c.get('/api/trash/spaces')).body.items as { id: string }[]).map((s) => s.id);
    const mine = (await sam.client.get('/api/trash/spaces')).body.items.find((s: { id: string }) => s.id === spaceId);
    expect(mine).toMatchObject({ id: spaceId, key: 'ops', name: 'Operations', deletedBy: { id: sam.user.id, name: 'Sam' } });
    expect(new Date(mine.purgeAt).getTime() - new Date(mine.deletedAt).getTime()).toBe(30 * DAY);
    expect(await listed(ada.client)).toContain(spaceId);
    expect(await listed(ed.client)).not.toContain(spaceId);
    expect(await listed(vi.client)).not.toContain(spaceId);
    for (const c of [ed.client, vi.client, nm.client]) {
      expect((await c.post(`/api/trash/spaces/${spaceId}/restore`)).status).toBe(404);
      expect((await c.del(`/api/trash/spaces/${spaceId}`)).status).toBe(404);
    }
    // A live space is not in the trash: 404 on the trash-space routes.
    const engId = (await sam.client.get('/api/spaces/eng')).body.space.id as string;
    expect((await sam.client.post(`/api/trash/spaces/${engId}/restore`)).status).toBe(404);

    const restored = await sam.client.post(`/api/trash/spaces/${spaceId}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ space: { id: spaceId, key: 'ops', name: 'Operations' } });
    expect(await snapshot()).toEqual(before);
    expect(await searchIds(vi.client, 'zanthoxyl')).toEqual([o1]);
    expect((await vi.client.get(`/api/attachments/${file}`)).status).toBe(200);
    expect(await listed(sam.client)).not.toContain(spaceId);

    // Trash it again; the instance admin deletes it for good, file bytes included.
    expect((await sam.client.del('/api/spaces/ops')).status).toBe(204);
    expect((await ada.client.del(`/api/trash/spaces/${spaceId}`)).status).toBe(204);
    expect((await ctx.pool.query('select 1 from spaces where id = $1', [spaceId])).rowCount).toBe(0);
    expect((await ctx.pool.query('select 1 from pages where id = any($1)', [[o1, o2, o3]])).rowCount).toBe(0);
    expect(await storedBytes(file)).toBeNull();
    expect((await sam.client.post(`/api/trash/spaces/${spaceId}/restore`)).status).toBe(404);
    // The key is free again.
    expect((await sam.client.post('/api/spaces', { key: 'ops', name: 'Ops' })).status).toBe(201);
  });

  it('purgeExpired also deletes a space trashed more than the retention days ago', async () => {
    const { sam } = w;
    expect((await sam.client.post('/api/spaces', { key: 'old', name: 'Old' })).status).toBe(201);
    const id = (await sam.client.get('/api/spaces/old')).body.space.id as string;
    const page = await makePage(sam.client, 'Old page', null, undefined, 'old');
    const file = await upload(ctx.app, sam.client, page);
    expect((await sam.client.del('/api/spaces/old')).status).toBe(204);
    const at = Date.now();
    await purgeExpired(ctx.db, ctx.app.storage, new Date(at + 29 * DAY), 30);
    expect((await ctx.pool.query('select 1 from spaces where id = $1', [id])).rowCount).toBe(1);
    const out = await purgeExpired(ctx.db, ctx.app.storage, new Date(at + 31 * DAY), 30);
    expect(out.spaces).toBeGreaterThanOrEqual(1);
    expect((await ctx.pool.query('select 1 from spaces where id = $1', [id])).rowCount).toBe(0);
    expect(await storedBytes(file)).toBeNull();
  });
});

describe('trash: migration and sign-in', () => {
  it('the 0007_trash back-fill turns an old-style delete of a page and its sub-page into one trash item', async () => {
    const { ed } = w;
    const old = await makePage(ed.client, 'Old style');
    const oldChild = await makePage(ed.client, 'Old style child', old);
    // Deleted the way the server did before trash: one statement, deleted_at only.
    await ctx.pool.query('update pages set deleted_at = now(), deleted_by = null, trash_root_id = null where id = any($1)', [[old, oldChild]]);
    expect((await trashList(ed.client)).items.map((i) => i.id)).not.toContain(old);

    const sql = readFileSync(new URL('../drizzle/0007_trash.sql', import.meta.url), 'utf8');
    const backfill = sql.split('--> statement-breakpoint').at(-1)!;
    expect(backfill).toMatch(/UPDATE "pages" SET "trash_root_id"/);
    await ctx.pool.query(backfill);

    const items = (await trashList(ed.client)).items.filter((i) => i.id === old || i.id === oldChild);
    expect(items).toEqual([expect.objectContaining({ id: old, subPages: 1, deletedBy: null })]);
    expect((await ed.client.post(`/api/pages/${old}/restore`)).status).toBe(200);
    expect((await ed.client.get(`/api/pages/${oldChild}`)).body.page.parentId).toBe(old);
  });

  it('every trash route needs a session', async () => {
    const anon = new Client(ctx.app);
    const id = '00000000-0000-4000-8000-000000000000';
    const routes: [string, string][] = [
      ['GET', '/api/spaces/eng/trash'],
      ['DELETE', '/api/spaces/eng/trash'],
      ['DELETE', '/api/spaces/eng'],
      ['POST', `/api/pages/${id}/restore`],
      ['DELETE', `/api/pages/${id}/purge`],
      ['DELETE', `/api/pages/${id}`],
      ['GET', '/api/trash/spaces'],
      ['POST', `/api/trash/spaces/${id}/restore`],
      ['DELETE', `/api/trash/spaces/${id}`],
    ];
    for (const [method, url] of routes) {
      const res = await anon.req(method as 'GET', url, method === 'POST' ? {} : undefined);
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });
});
