// Stage 3b: page history (docs/done-checks/03-search-history.md, "3b — Page
// history, server side"): the snapshots createPage and savePage write, and the
// list, read-one and restore routes, all against real Postgres.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '@stillwater/shared';
import { savePage } from '../src/pages/pages.js';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'stillwater-history-'));
let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setupApp({ UPLOAD_DIR: uploadDir });
  await ctx.reset();
});
afterEach(() => ctx.close());
afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

const para = (text: string): Doc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as Doc;

/** All text in a doc, in order (the server adds block ids on save, so compare text). */
const textOf = (doc: unknown): string => {
  const n = doc as { text?: string; content?: unknown[] };
  return (n.text ?? '') + (n.content ?? []).map(textOf).join('');
};

type Snap = { version: number; title: string; doc: unknown; author_id: string | null; restored_from: number | null; created_at: Date; saved_at: Date };

/** All snapshots of a page, newest first. */
async function snaps(pageId: string): Promise<Snap[]> {
  const res = await ctx.pool.query<Snap>(
    'select version, title, doc, author_id, restored_from, created_at, saved_at from page_versions where page_id = $1 order by version desc',
    [pageId],
  );
  return res.rows;
}

/** The invariant: the newest snapshot holds exactly the page's current version, title and doc. */
async function expectInvariant(pageId: string) {
  const page = (await ctx.pool.query('select version, title, doc from pages where id = $1', [pageId])).rows[0];
  const [latest] = await snaps(pageId);
  expect(latest).toBeDefined();
  expect({ version: latest!.version, title: latest!.title, doc: latest!.doc }).toEqual(page);
}

/** Pretend the newest snapshot was opened `minutes` ago (no sleeping). */
async function ageLatest(pageId: string, minutes: number) {
  await ctx.pool.query(
    `update page_versions set created_at = created_at - make_interval(mins => $2)
     where id = (select id from page_versions where page_id = $1 order by version desc limit 1)`,
    [pageId, minutes],
  );
}

/** Ada (instance admin) and Bea, both editors of the open space "eng"; one page in it. */
async function setup() {
  const ada = await signup(ctx.app, 'Ada');
  const bea = await signup(ctx.app, 'Bea');
  expect((await ada.client.post('/api/spaces', { key: 'eng', name: 'Engineering' })).status).toBe(201);
  expect((await ada.client.put(`/api/spaces/eng/members/${bea.user.id}`, { role: 'editor' })).status).toBe(200);
  const res = await ada.client.post('/api/spaces/eng/pages', { title: 'Runbook', parentId: null });
  expect(res.status).toBe(201);
  return { ada, bea, pageId: res.body.page.id as string };
}

async function save(c: Client, pageId: string, baseVersion: number, change: { title?: string; doc?: Doc }) {
  return c.put(`/api/pages/${pageId}`, { baseVersion, ...change });
}

describe('page history snapshots', () => {
  it('creating a page makes snapshot version 1 by its creator', async () => {
    const { ada, pageId } = await setup();
    const list = await snaps(pageId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 1, title: 'Runbook', author_id: ada.user.id, restored_from: null });
    await expectInvariant(pageId);
  });

  it('two quick saves by the same author fold into one snapshot with the second save', async () => {
    const { ada, pageId } = await setup();
    // The creation snapshot is Ada's and fresh, so both saves fold into it too.
    expect((await save(ada.client, pageId, 1, { doc: para('first') })).body.version).toBe(2);
    await expectInvariant(pageId);
    const opened = (await snaps(pageId))[0]!.created_at;
    expect((await save(ada.client, pageId, 2, { title: 'Runbook v2', doc: para('second') })).body.version).toBe(3);
    await expectInvariant(pageId);

    const list = await snaps(pageId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 3, title: 'Runbook v2', author_id: ada.user.id });
    expect(textOf(list[0]!.doc)).toBe('second');
    // Folding keeps when the snapshot was opened and moves saved_at forward.
    expect(list[0]!.created_at).toEqual(opened);
    expect(list[0]!.saved_at.getTime()).toBeGreaterThanOrEqual(opened.getTime());
  });

  it('a save by a second author starts a new snapshot, and so does the first author coming back', async () => {
    const { ada, bea, pageId } = await setup();
    await save(ada.client, pageId, 1, { doc: para('ada writes') });
    await expectInvariant(pageId);
    await save(bea.client, pageId, 2, { doc: para('bea writes') });
    await expectInvariant(pageId);
    await save(ada.client, pageId, 3, { doc: para('ada again') });
    await expectInvariant(pageId);

    const list = await snaps(pageId);
    expect(list.map((s) => [s.version, s.author_id])).toEqual([
      [4, ada.user.id],
      [3, bea.user.id],
      [2, ada.user.id],
    ]);
    expect(textOf(list[1]!.doc)).toBe('bea writes');
  });

  it('a save more than 5 minutes after the snapshot opened starts a new one, even mid-session', async () => {
    const { ada, pageId } = await setup();
    await save(ada.client, pageId, 1, { doc: para('one') });
    await ageLatest(pageId, 4); // still inside the window: folds
    await save(ada.client, pageId, 2, { doc: para('two') });
    await expectInvariant(pageId);
    expect(await snaps(pageId)).toHaveLength(1);

    await ageLatest(pageId, 2); // now opened 6 minutes ago: measured from created_at, not the last save
    await save(ada.client, pageId, 3, { doc: para('three') });
    await expectInvariant(pageId);
    const list = await snaps(pageId);
    expect(list.map((s) => s.version)).toEqual([4, 3]);
    expect(textOf(list[1]!.doc)).toBe('two');
  });

  it('a title-only save still snapshots the current doc', async () => {
    const { ada, bea, pageId } = await setup();
    await save(ada.client, pageId, 1, { doc: para('body stays') });
    await save(bea.client, pageId, 2, { title: 'Renamed' });
    await expectInvariant(pageId);
    expect((await snaps(pageId))[0]).toMatchObject({ version: 3, title: 'Renamed' });
    expect(textOf((await snaps(pageId))[0]!.doc)).toBe('body stays');
  });

  it('a refused (409) save writes no snapshot, and a move writes none', async () => {
    const { ada, bea, pageId } = await setup();
    await save(ada.client, pageId, 1, { doc: para('ada') });
    const before = await snaps(pageId);

    const stale = await save(bea.client, pageId, 1, { doc: para('stale') });
    expect(stale.status).toBe(409);
    expect(await snaps(pageId)).toEqual(before);
    await expectInvariant(pageId);

    const other = await ada.client.post('/api/spaces/eng/pages', { title: 'Parent', parentId: null });
    const parentId = other.body.page.id as string;
    expect((await bea.client.post(`/api/pages/${pageId}/move`, { parentId, index: 0 })).status).toBe(200);
    expect(await snaps(pageId)).toEqual(before);
    await expectInvariant(pageId);
  });

  it('a restore snapshot is never folded into: the next save by the same author makes a new one', async () => {
    const { ada, pageId } = await setup();
    await save(ada.client, pageId, 1, { doc: para('first') });
    await ageLatest(pageId, 10);
    await save(ada.client, pageId, 2, { doc: para('second') });
    // What the restore route does: write the old title and doc back through
    // savePage, marked as a restore.
    const { version } = await savePage(ctx.db, pageId, { title: 'Runbook', doc: para('first') }, 3, ada.user.id, { restoredFrom: 2 });
    expect(version).toBe(4);
    await expectInvariant(pageId);
    let list = await snaps(pageId);
    expect(list[0]).toMatchObject({ version: 4, restored_from: 2 });
    expect(textOf(list[0]!.doc)).toBe('first');
    expect(list.map((s) => s.version)).toEqual([4, 3, 2]);

    await save(ada.client, pageId, 4, { doc: para('after restore') });
    await expectInvariant(pageId);
    list = await snaps(pageId);
    expect(list.map((s) => [s.version, s.restored_from])).toEqual([
      [5, null],
      [4, 2],
      [3, null],
      [2, null],
    ]);
    expect(textOf(list[1]!.doc)).toBe('first');
  });

  it('a removed author leaves the snapshot with no author', async () => {
    const { bea, pageId } = await setup();
    await save(bea.client, pageId, 1, { doc: para('bea') });
    await ctx.pool.query('delete from users where id = $1', [bea.user.id]);
    const list = await snaps(pageId);
    expect(list[0]).toMatchObject({ version: 2, author_id: null });
  });
});

describe('migration 0003 backfill', () => {
  const migration = readFileSync(new URL('../drizzle/0003_page_versions.sql', import.meta.url), 'utf8');
  const backfill = migration
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .find((s) => /INSERT INTO "page_versions"/.test(s));

  it('gives a page with no snapshot one of its current state, and skips pages that have one', async () => {
    expect(backfill).toBeDefined();
    const { ada, bea, pageId } = await setup();
    await save(bea.client, pageId, 1, { title: 'Old page', doc: para('from before history') });
    const second = (await ada.client.post('/api/spaces/eng/pages', { title: 'Kept', parentId: null })).body.page.id as string;
    // Make the first page look like it existed before migration 0003.
    await ctx.pool.query('delete from page_versions where page_id = $1', [pageId]);
    const keptBefore = await snaps(second);

    await ctx.pool.query(backfill!);
    const list = await snaps(pageId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 2, title: 'Old page', author_id: bea.user.id, restored_from: null });
    expect(textOf(list[0]!.doc)).toBe('from before history');
    await expectInvariant(pageId);
    expect(await snaps(second)).toEqual(keptBefore);

    // Running it again changes nothing.
    await ctx.pool.query(backfill!);
    expect(await snaps(pageId)).toHaveLength(1);
  });
});

// ---------- The history routes ----------

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(c: Client, pageId: string) {
  const boundary = '----stillwater' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dot.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/pages/${pageId}/attachments`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: c.cookie },
    payload: Buffer.concat([head, PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const versionsOf = (c: Client, pageId: string, before?: number) =>
  c.get(`/api/pages/${pageId}/versions${before !== undefined ? `?before=${before}` : ''}`);
const restore = (c: Client, pageId: string, version: number, baseVersion: number) =>
  c.post(`/api/pages/${pageId}/versions/${version}/restore`, { baseVersion });
const currentPage = async (c: Client, pageId: string) => (await c.get(`/api/pages/${pageId}`)).body.page;

/** Three saves that each leave their own snapshot (Ada and Bea take turns): versions 1 to 4. */
async function savedThreeTimes() {
  const s = await setup();
  await save(s.bea.client, s.pageId, 1, { title: 'Runbook two', doc: para('two') });
  await save(s.ada.client, s.pageId, 2, { title: 'Runbook three', doc: para('three') });
  await save(s.bea.client, s.pageId, 3, { title: 'Runbook four', doc: para('four') });
  await save(s.ada.client, s.pageId, 1, { doc: para('never') }); // stale, 409
  return s;
}

describe('history routes', () => {
  it('lists versions newest first with author, time and restore mark, and no doc bodies', async () => {
    const { ada, bea, pageId } = await savedThreeTimes();
    const res = await versionsOf(ada.client, pageId);
    expect(res.status).toBe(200);
    expect(res.body.nextBefore).toBeNull();
    expect(res.body.versions).toEqual([
      { version: 4, title: 'Runbook four', author: { id: bea.user.id, name: 'Bea' }, savedAt: expect.any(String), restoredFrom: null },
      { version: 3, title: 'Runbook three', author: { id: ada.user.id, name: 'Ada' }, savedAt: expect.any(String), restoredFrom: null },
      { version: 2, title: 'Runbook two', author: { id: bea.user.id, name: 'Bea' }, savedAt: expect.any(String), restoredFrom: null },
      { version: 1, title: 'Runbook', author: { id: ada.user.id, name: 'Ada' }, savedAt: expect.any(String), restoredFrom: null },
    ]);
    const saved = (await snaps(pageId)).map((s) => s.saved_at.toISOString());
    expect(res.body.versions.map((v: { savedAt: string }) => v.savedAt)).toEqual(saved);

    // A removed author shows as null.
    await ctx.pool.query('delete from users where id = $1', [bea.user.id]);
    expect((await versionsOf(ada.client, pageId)).body.versions[0].author).toBeNull();
  });

  it('reads one version with its title and doc; unknown, odd or another page\'s version is 404', async () => {
    const { ada, pageId } = await savedThreeTimes();
    const res = await ada.client.get(`/api/pages/${pageId}/versions/2`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, title: 'Runbook two', restoredFrom: null });
    expect(textOf(res.body.doc)).toBe('two');

    const other = (await ada.client.post('/api/spaces/eng/pages', { title: 'Other', parentId: null })).body.page.id as string;
    await save(ada.client, other, 1, { doc: para('x') });
    await ageLatest(other, 10);
    await save(ada.client, other, 2, { doc: para('y') });
    // Version 3 exists on `other` only, and 4 on the first page only.
    expect((await ada.client.get(`/api/pages/${pageId}/versions/4`)).status).toBe(200);
    expect((await ada.client.get(`/api/pages/${other}/versions/4`)).status).toBe(404);
    for (const bad of ['99', '0', '-1', 'abc', '1.5', '99999999999']) {
      expect((await ada.client.get(`/api/pages/${pageId}/versions/${bad}`)).status, bad).toBe(404);
    }
  });

  it('restoring version 1 of a page saved 3 times brings it back as a new version, keeps every snapshot, and can be undone', async () => {
    const { ada, pageId } = await savedThreeTimes();
    const res = await restore(ada.client, pageId, 1, 4);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 5 });
    await expectInvariant(pageId);

    let page = await currentPage(ada.client, pageId);
    expect(page).toMatchObject({ version: 5, title: 'Runbook' });
    expect(textOf(page.doc)).toBe('');
    const v1 = (await ada.client.get(`/api/pages/${pageId}/versions/1`)).body;
    expect(page.doc).toEqual(v1.doc);

    let list = (await versionsOf(ada.client, pageId)).body.versions;
    expect(list.map((v: { version: number; restoredFrom: number | null }) => [v.version, v.restoredFrom])).toEqual([
      [5, 1],
      [4, null],
      [3, null],
      [2, null],
      [1, null],
    ]);

    // "Any earlier version": restore the pre-restore version 4 back.
    expect((await restore(ada.client, pageId, 4, 5)).body).toEqual({ version: 6 });
    await expectInvariant(pageId);
    page = await currentPage(ada.client, pageId);
    expect(page).toMatchObject({ version: 6, title: 'Runbook four' });
    expect(textOf(page.doc)).toBe('four');
    list = (await versionsOf(ada.client, pageId)).body.versions;
    expect(list.map((v: { version: number; restoredFrom: number | null }) => [v.version, v.restoredFrom])).toEqual([
      [6, 4],
      [5, 1],
      [4, null],
      [3, null],
      [2, null],
      [1, null],
    ]);
  });

  it('an edit by the same author right after a restore makes a new snapshot and leaves the restore one alone', async () => {
    const { ada, pageId } = await savedThreeTimes();
    await restore(ada.client, pageId, 2, 4);
    const restoreSnap = (await snaps(pageId))[0]!;
    expect(restoreSnap).toMatchObject({ version: 5, restored_from: 2, author_id: ada.user.id });

    expect((await save(ada.client, pageId, 5, { doc: para('edited after') })).status).toBe(200);
    await expectInvariant(pageId);
    const list = await snaps(pageId);
    expect(list.map((s) => [s.version, s.restored_from])).toEqual([
      [6, null],
      [5, 2],
      [4, null],
      [3, null],
      [2, null],
      [1, null],
    ]);
    expect(list[1]).toEqual(restoreSnap);
  });

  it('a stale baseVersion on restore gets 409 and changes nothing', async () => {
    const { ada, pageId } = await savedThreeTimes();
    const before = await snaps(pageId);
    const pageBefore = (await ctx.pool.query('select * from pages where id = $1', [pageId])).rows[0];
    const res = await restore(ada.client, pageId, 1, 3);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stale_version');
    expect(await snaps(pageId)).toEqual(before);
    expect((await ctx.pool.query('select * from pages where id = $1', [pageId])).rows[0]).toEqual(pageBefore);
    // A body without a baseVersion is refused too.
    expect((await ada.client.post(`/api/pages/${pageId}/versions/1/restore`, {})).status).toBe(400);
  });

  it('a restored doc passes the same validation as a normal save', async () => {
    const { ada, pageId } = await savedThreeTimes();
    // A snapshot whose doc is not a document at all (as if written by a bug).
    await ctx.pool.query(`update page_versions set doc = '{"type":"paragraph"}'::jsonb where page_id = $1 and version = 2`, [pageId]);
    const before = await snaps(pageId);
    expect((await restore(ada.client, pageId, 2, 4)).status).toBe(400);
    expect(await snaps(pageId)).toEqual(before);
    expect((await currentPage(ada.client, pageId)).version).toBe(4);
  });

  it('a viewer can list and read but gets 403 on restore; a non-member of a restricted space gets 404 on all three', async () => {
    const ada = await signup(ctx.app, 'Ada');
    const vic = await signup(ctx.app, 'Vic');
    const nat = await signup(ctx.app, 'Nat');
    expect((await ada.client.post('/api/spaces', { key: 'hr', name: 'People', visibility: 'restricted' })).status).toBe(201);
    await ada.client.put(`/api/spaces/hr/members/${vic.user.id}`, { role: 'viewer' });
    const pageId = (await ada.client.post('/api/spaces/hr/pages', { title: 'Pay', parentId: null })).body.page.id as string;
    await save(ada.client, pageId, 1, { doc: para('bands') });

    expect((await versionsOf(vic.client, pageId)).status).toBe(200);
    expect((await vic.client.get(`/api/pages/${pageId}/versions/2`)).status).toBe(200);
    expect((await restore(vic.client, pageId, 2, 2)).status).toBe(403);

    expect((await versionsOf(nat.client, pageId)).status).toBe(404);
    expect((await nat.client.get(`/api/pages/${pageId}/versions/2`)).status).toBe(404);
    expect((await restore(nat.client, pageId, 2, 2)).status).toBe(404);

    const anon = new Client(ctx.app);
    expect((await versionsOf(anon, pageId)).status).toBe(401);
    expect((await anon.get(`/api/pages/${pageId}/versions/2`)).status).toBe(401);
    expect((await restore(anon, pageId, 2, 2)).status).toBe(401);

    // An editor member may restore, and nothing above changed the page.
    expect((await currentPage(ada.client, pageId)).version).toBe(2);
    // (Ada's quick save folded into the first snapshot, so version 2 is the only one.)
    expect((await versionsOf(ada.client, pageId)).body.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    expect((await restore(ada.client, pageId, 2, 2)).body).toEqual({ version: 3 });
  });

  it('a deleted page, an unknown page and an unknown version give 404 on restore', async () => {
    const { ada, pageId } = await savedThreeTimes();
    expect((await restore(ada.client, pageId, 99, 4)).status).toBe(404);
    expect((await restore(ada.client, '00000000-0000-4000-8000-000000000000', 1, 1)).status).toBe(404);
    expect((await ada.client.del(`/api/pages/${pageId}`)).status).toBe(200);
    expect((await restore(ada.client, pageId, 1, 4)).status).toBe(404);
    expect((await versionsOf(ada.client, pageId)).status).toBe(404);
    expect((await ada.client.get(`/api/pages/${pageId}/versions/1`)).status).toBe(404);
  });

  it("an image block's attachment still downloads after a restore brings it back", async () => {
    const { ada, bea, pageId } = await setup();
    const attachmentId = await upload(ada.client, pageId);
    const withImage = { type: 'doc', content: [{ type: 'image', attrs: { attachmentId, alt: '', caption: 'Dot' } }] } as Doc;
    expect((await save(ada.client, pageId, 1, { doc: withImage })).status).toBe(200);
    // Bea takes the image out.
    expect((await save(bea.client, pageId, 2, { doc: para('no picture') })).status).toBe(200);

    expect((await restore(bea.client, pageId, 2, 3)).status).toBe(200);
    const page = await currentPage(bea.client, pageId);
    expect(page.doc.content[0]).toMatchObject({ type: 'image', attrs: { attachmentId } });
    const got = await bea.client.get(`/api/attachments/${attachmentId}`);
    expect(got.status).toBe(200);
    expect(got.raw.rawPayload.equals(PNG)).toBe(true);
  });

  it('pages the list: 60 snapshots give 50, then 10 with before', async () => {
    const { ada, bea, pageId } = await setup();
    for (let v = 1; v < 60; v++) {
      const who = v % 2 === 1 ? bea : ada; // alternate authors so every save is its own snapshot
      expect((await save(who.client, pageId, v, { doc: para(`save ${v}`) })).status).toBe(200);
    }
    expect(await snaps(pageId)).toHaveLength(60);

    const first = (await versionsOf(ada.client, pageId)).body;
    expect(first.versions).toHaveLength(50);
    expect(first.versions[0].version).toBe(60);
    expect(first.versions[49].version).toBe(11);
    expect(first.nextBefore).toBe(11);
    expect(first.versions[0]).not.toHaveProperty('doc');

    const second = (await versionsOf(ada.client, pageId, first.nextBefore)).body;
    expect(second.versions.map((v: { version: number }) => v.version)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(second.nextBefore).toBeNull();

    expect((await versionsOf(ada.client, pageId, 1)).body).toEqual({ versions: [], nextBefore: null });
    expect((await ada.client.get(`/api/pages/${pageId}/versions?before=abc`)).status).toBe(400);
  });
});
