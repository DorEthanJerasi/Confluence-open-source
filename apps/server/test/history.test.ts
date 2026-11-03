// Stage 3b: page history snapshots written by createPage and savePage
// (docs/done-checks/03-search-history.md, "3b — Page history, server side").
// The history routes (list, view, restore) come in the next item; this file
// checks the storage rules against real Postgres.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Doc } from '@stillwater/shared';
import { savePage } from '../src/pages/pages.js';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setupApp();
  await ctx.reset();
});
afterEach(() => ctx.close());

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
    // What the restore route (next item) will do: write snapshot 2's title and
    // doc back through savePage, marked as a restore.
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
