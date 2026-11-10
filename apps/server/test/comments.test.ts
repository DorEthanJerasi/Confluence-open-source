// Page comments, server side (docs/done-checks/07-comments.md, "7a — Server"):
// the page_comments table and the list, create, edit, delete, resolve and
// reopen routes, all against real Postgres.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@stillwater/shared';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

const uploadDir = mkdtempSync(join(tmpdir(), 'stillwater-comments-'));
let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setupApp({ UPLOAD_DIR: uploadDir });
  await ctx.reset();
});
afterEach(() => ctx.close());
afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

const twoParas: Doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
  ],
} as Doc;

/**
 * Restricted space "eng". Ada is the instance admin. Bea and Cal are editors
 * of the space, Sam is a space admin (not an instance admin), Val is a viewer
 * and Nia is not a member. One page with two paragraphs.
 */
async function setup() {
  const ada = await signup(ctx.app, 'Ada');
  const bea = await signup(ctx.app, 'Bea');
  const cal = await signup(ctx.app, 'Cal');
  const sam = await signup(ctx.app, 'Sam');
  const val = await signup(ctx.app, 'Val');
  const nia = await signup(ctx.app, 'Nia');
  expect((await ada.client.post('/api/spaces', { key: 'eng', name: 'Engineering', visibility: 'restricted' })).status).toBe(201);
  for (const [who, role] of [
    [bea, 'editor'],
    [cal, 'editor'],
    [sam, 'admin'],
    [val, 'viewer'],
  ] as const) {
    expect((await ada.client.put(`/api/spaces/eng/members/${who.user.id}`, { role })).status).toBe(200);
  }
  const res = await ada.client.post('/api/spaces/eng/pages', { title: 'Runbook', parentId: null, doc: twoParas });
  expect(res.status).toBe(201);
  const pageId = res.body.page.id as string;
  const page = (await ada.client.get(`/api/pages/${pageId}`)).body.page;
  const blocks = (page.doc.content as { attrs: { id: string } }[]).map((b) => b.attrs.id);
  expect(blocks).toHaveLength(2);
  return { ada, bea, cal, sam, val, nia, pageId, blocks, version: page.version as number };
}

const list = async (c: Client, pageId: string) => {
  const res = await c.get(`/api/pages/${pageId}/comments`);
  expect(res.status).toBe(200);
  return res.body.threads as any[];
};

async function comment(c: Client, pageId: string, body: Record<string, unknown>) {
  const res = await c.post(`/api/pages/${pageId}/comments`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.comment as { id: string; blockId: string | null; parentId: string | null; body: string };
}

/** pages row and history count, to prove comments never touch them. */
async function pageState(pageId: string) {
  const page = (await ctx.pool.query('select version, doc, updated_at from pages where id = $1', [pageId])).rows[0];
  const versions = (await ctx.pool.query('select count(*)::int as n from page_versions where page_id = $1', [pageId])).rows[0].n;
  return { page, versions };
}

describe('page comments', () => {
  it('an editor starts a page comment and a block comment; GET returns both', async () => {
    const { bea, pageId, blocks } = await setup();
    const before = Date.now();
    const pageWide = await comment(bea.client, pageId, { body: 'Looks good overall' });
    const onBlock = await comment(bea.client, pageId, { body: 'Is this right?', blockId: blocks[1] });
    expect(pageWide).toMatchObject({ blockId: null, parentId: null, body: 'Looks good overall' });
    expect(onBlock).toMatchObject({ blockId: blocks[1], parentId: null });

    const threads = await list(bea.client, pageId);
    expect(threads.map((t) => t.id)).toEqual([pageWide.id, onBlock.id]);
    expect(threads[0]).toMatchObject({
      blockId: null,
      body: 'Looks good overall',
      author: { id: bea.user.id, name: 'Bea' },
      editedAt: null,
      resolvedAt: null,
      resolvedBy: null,
      deleted: false,
      blockMissing: false,
      replies: [],
    });
    expect(threads[1]).toMatchObject({ blockId: blocks[1], body: 'Is this right?', blockMissing: false });
    for (const t of threads) {
      const at = Date.parse(t.createdAt);
      expect(at).toBeGreaterThanOrEqual(before - 5000);
      expect(at).toBeLessThanOrEqual(Date.now() + 5000);
    }
  });

  it('a viewer of the space replies to a thread and starts one of their own', async () => {
    const { bea, val, pageId, blocks } = await setup();
    const root = await comment(bea.client, pageId, { body: 'Check this', blockId: blocks[0] });
    // blockId with parentId is ignored: the reply takes the root's block.
    const reply = await comment(val.client, pageId, { body: 'Checked', parentId: root.id, blockId: blocks[1] });
    expect(reply).toMatchObject({ parentId: root.id, blockId: blocks[0] });
    const own = await comment(val.client, pageId, { body: 'A question from me' });

    const threads = await list(val.client, pageId);
    expect(threads.map((t) => t.id)).toEqual([root.id, own.id]);
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0]).toMatchObject({ id: reply.id, body: 'Checked', author: { id: val.user.id, name: 'Val' }, editedAt: null });
    expect(threads[1].author).toEqual({ id: val.user.id, name: 'Val' });
  });

  it('refuses a reply to a reply, a root from another page, and a block not in the page', async () => {
    const { ada, bea, pageId, blocks } = await setup();
    const root = await comment(bea.client, pageId, { body: 'Root' });
    const reply = await comment(bea.client, pageId, { body: 'Reply', parentId: root.id });
    expect((await bea.client.post(`/api/pages/${pageId}/comments`, { body: 'Deeper', parentId: reply.id })).status).toBe(400);

    const other = (await ada.client.post('/api/spaces/eng/pages', { title: 'Other', parentId: null })).body.page.id as string;
    const otherRoot = await comment(bea.client, other, { body: 'Elsewhere' });
    expect((await bea.client.post(`/api/pages/${pageId}/comments`, { body: 'Cross', parentId: otherRoot.id })).status).toBe(400);

    expect((await bea.client.post(`/api/pages/${pageId}/comments`, { body: 'Nope', blockId: 'not-a-block' })).status).toBe(400);
    expect((await bea.client.post(`/api/pages/${other}/comments`, { body: 'Nope', blockId: blocks[0] })).status).toBe(400);
    expect(await list(bea.client, pageId)).toHaveLength(1);
  });

  it('checks bodies: empty, spaces only, too long and unknown fields are 400; text is trimmed, line breaks kept', async () => {
    const { bea, pageId } = await setup();
    const post = (body: unknown) => bea.client.post(`/api/pages/${pageId}/comments`, body);
    expect((await post({ body: '' })).status).toBe(400);
    expect((await post({ body: '   \n ' })).status).toBe(400);
    expect((await post({ body: 'x'.repeat(4001) })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ body: 'hi', extra: true })).status).toBe(400);
    expect((await post({ body: 'x'.repeat(4000) })).status).toBe(201);
    const c = await comment(bea.client, pageId, { body: '  line one\nline two  ' });
    expect(c.body).toBe('line one\nline two');

    expect((await bea.client.patch(`/api/comments/${c.id}`, { body: ' ' })).status).toBe(400);
    expect((await bea.client.patch(`/api/comments/${c.id}`, { body: 'ok', blockId: null })).status).toBe(400);
    expect((await bea.client.patch(`/api/comments/${c.id}`, { body: 'y'.repeat(4001) })).status).toBe(400);
  });

  it('edit: the author can and it sets editedAt; another editor, a viewer and a space admin get 403', async () => {
    const { ada, bea, cal, sam, val, pageId } = await setup();
    const c = await comment(bea.client, pageId, { body: 'Draft' });
    expect((await cal.client.patch(`/api/comments/${c.id}`, { body: 'Hijack' })).status).toBe(403);
    expect((await val.client.patch(`/api/comments/${c.id}`, { body: 'Hijack' })).status).toBe(403);
    expect((await sam.client.patch(`/api/comments/${c.id}`, { body: 'Hijack' })).status).toBe(403);
    expect((await ada.client.patch(`/api/comments/${c.id}`, { body: 'Hijack' })).status).toBe(403);

    const res = await bea.client.patch(`/api/comments/${c.id}`, { body: 'Final' });
    expect(res.status).toBe(200);
    expect(res.body.comment.body).toBe('Final');
    expect(res.body.comment.editedAt).not.toBeNull();
    const [t] = await list(bea.client, pageId);
    expect(t).toMatchObject({ id: c.id, body: 'Final' });
    expect(t.editedAt).not.toBeNull();
    expect(t.createdAt).not.toBe(t.editedAt);
  });

  it('delete: the author can, a space admin can delete anyone’s, another editor gets 403; soft delete clears the body', async () => {
    const { bea, cal, sam, val, pageId } = await setup();
    const lone = await comment(bea.client, pageId, { body: 'Lonely' });
    const withReply = await comment(bea.client, pageId, { body: 'Has a reply' });
    const reply = await comment(val.client, pageId, { body: 'The reply', parentId: withReply.id });
    const calsOwn = await comment(cal.client, pageId, { body: 'Cal says' });

    // An editor cannot delete someone else's comment; a viewer cannot either.
    expect((await cal.client.del(`/api/comments/${lone.id}`)).status).toBe(403);
    expect((await val.client.del(`/api/comments/${lone.id}`)).status).toBe(403);

    // The author deletes their own: a root with no replies is gone.
    expect((await bea.client.del(`/api/comments/${lone.id}`)).status).toBe(204);
    // A space admin (not an instance admin) deletes someone else's root that has a reply.
    expect((await sam.client.del(`/api/comments/${withReply.id}`)).status).toBe(204);
    // Cal deletes their own.
    expect((await cal.client.del(`/api/comments/${calsOwn.id}`)).status).toBe(204);

    const threads = await list(bea.client, pageId);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: withReply.id, deleted: true, body: '', author: null });
    expect(threads[0].replies.map((r: { id: string }) => r.id)).toEqual([reply.id]);

    // A deleted comment is 404 to edit and to delete again.
    expect((await bea.client.patch(`/api/comments/${lone.id}`, { body: 'back?' })).status).toBe(404);
    expect((await bea.client.del(`/api/comments/${lone.id}`)).status).toBe(404);

    // A deleted reply is not returned; with it gone, the deleted root goes too.
    expect((await val.client.del(`/api/comments/${reply.id}`)).status).toBe(204);
    expect(await list(bea.client, pageId)).toEqual([]);

    const rows = (await ctx.pool.query('select body, deleted_at from page_comments where page_id = $1', [pageId])).rows;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.body).toBe('');
      expect(r.deleted_at).not.toBeNull();
    }
  });

  it('resolve and reopen: an editor can, a viewer gets 403, a reply gives 400; resolved threads sort after open ones', async () => {
    const { bea, cal, val, pageId } = await setup();
    const a = await comment(bea.client, pageId, { body: 'A' });
    const b = await comment(bea.client, pageId, { body: 'B' });
    const c = await comment(bea.client, pageId, { body: 'C' });
    const reply = await comment(val.client, pageId, { body: 'reply', parentId: b.id });

    expect((await val.client.post(`/api/comments/${a.id}/resolve`)).status).toBe(403);
    expect((await val.client.post(`/api/comments/${a.id}/reopen`)).status).toBe(403);
    expect((await cal.client.post(`/api/comments/${reply.id}/resolve`)).status).toBe(400);

    const res = await cal.client.post(`/api/comments/${a.id}/resolve`);
    expect(res.status).toBe(200);
    expect(res.body.comment.resolvedBy).toEqual({ id: cal.user.id, name: 'Cal' });
    const firstAt = res.body.comment.resolvedAt;
    expect(firstAt).not.toBeNull();
    // Twice is fine and changes nothing.
    const again = await bea.client.post(`/api/comments/${a.id}/resolve`);
    expect(again.status).toBe(200);
    expect(again.body.comment).toMatchObject({ resolvedAt: firstAt, resolvedBy: { id: cal.user.id } });

    await new Promise((r) => setTimeout(r, 5));
    expect((await cal.client.post(`/api/comments/${b.id}/resolve`)).status).toBe(200);

    // Open (oldest first), then resolved (newest resolved first).
    let threads = await list(val.client, pageId);
    expect(threads.map((t) => t.id)).toEqual([c.id, b.id, a.id]);
    expect(threads[1].resolvedBy).toEqual({ id: cal.user.id, name: 'Cal' });

    const reopened = await bea.client.post(`/api/comments/${a.id}/reopen`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.comment).toMatchObject({ resolvedAt: null, resolvedBy: null });
    expect((await bea.client.post(`/api/comments/${a.id}/reopen`)).status).toBe(200);
    threads = await list(val.client, pageId);
    expect(threads.map((t) => t.id)).toEqual([a.id, c.id, b.id]);

    // The database refuses a resolved reply outright.
    await expect(ctx.pool.query('update page_comments set resolved_at = now() where id = $1', [reply.id])).rejects.toThrow(/page_comments_reply_not_resolved/);
  });

  it('a non-member of the restricted space gets 404 everywhere until added as a viewer, and again once removed', async () => {
    const { ada, bea, nia, pageId } = await setup();
    const c = await comment(bea.client, pageId, { body: 'Members only' });
    const expectAll404 = async () => {
      expect((await nia.client.get(`/api/pages/${pageId}/comments`)).status).toBe(404);
      expect((await nia.client.post(`/api/pages/${pageId}/comments`, { body: 'hi' })).status).toBe(404);
      expect((await nia.client.post(`/api/pages/${pageId}/comments`, { body: 'hi', parentId: c.id })).status).toBe(404);
      expect((await nia.client.patch(`/api/comments/${c.id}`, { body: 'hi' })).status).toBe(404);
      expect((await nia.client.del(`/api/comments/${c.id}`)).status).toBe(404);
      expect((await nia.client.post(`/api/comments/${c.id}/resolve`)).status).toBe(404);
      expect((await nia.client.post(`/api/comments/${c.id}/reopen`)).status).toBe(404);
    };
    await expectAll404();

    expect((await ada.client.put(`/api/spaces/eng/members/${nia.user.id}`, { role: 'viewer' })).status).toBe(200);
    expect((await list(nia.client, pageId)).map((t) => t.id)).toEqual([c.id]);

    expect((await ada.client.del(`/api/spaces/eng/members/${nia.user.id}`)).status).toBeLessThan(300);
    await expectAll404();
    // Unknown and malformed ids are 404 too.
    expect((await bea.client.patch('/api/comments/00000000-0000-4000-8000-000000000000', { body: 'x' })).status).toBe(404);
    expect((await bea.client.del('/api/comments/not-a-uuid')).status).toBe(404);
    expect((await bea.client.get('/api/pages/not-a-uuid/comments')).status).toBe(404);
  });

  it('a deleted page: 404 on its comments; deleted for real, its comment rows are gone', async () => {
    const { bea, pageId } = await setup();
    const c = await comment(bea.client, pageId, { body: 'Soon gone' });
    expect((await bea.client.del(`/api/pages/${pageId}`)).status).toBe(200);
    expect((await bea.client.get(`/api/pages/${pageId}/comments`)).status).toBe(404);
    expect((await bea.client.post(`/api/pages/${pageId}/comments`, { body: 'hi' })).status).toBe(404);
    expect((await bea.client.patch(`/api/comments/${c.id}`, { body: 'hi' })).status).toBe(404);
    expect((await bea.client.del(`/api/comments/${c.id}`)).status).toBe(404);
    expect((await bea.client.post(`/api/comments/${c.id}/resolve`)).status).toBe(404);

    await ctx.pool.query('delete from pages where id = $1', [pageId]);
    const n = (await ctx.pool.query('select count(*)::int as n from page_comments where page_id = $1', [pageId])).rows[0].n;
    expect(n).toBe(0);
  });

  it('a block removed by a later save keeps its thread, marked blockMissing', async () => {
    const { bea, pageId, blocks, version } = await setup();
    const c = await comment(bea.client, pageId, { body: 'About the second one', blockId: blocks[1] });
    const page = (await bea.client.get(`/api/pages/${pageId}`)).body.page;
    const save = await bea.client.put(`/api/pages/${pageId}`, { baseVersion: version, doc: { type: 'doc', content: [page.doc.content[0]] } });
    expect(save.status).toBe(200);
    const [t] = await list(bea.client, pageId);
    expect(t).toMatchObject({ id: c.id, blockId: blocks[1], blockMissing: true });
    // A new comment cannot be put on the removed block.
    expect((await bea.client.post(`/api/pages/${pageId}/comments`, { body: 'x', blockId: blocks[1] })).status).toBe(400);
  });

  it('keeps a body like <img src=x onerror=alert(1)> as the same plain text', async () => {
    const { bea, pageId } = await setup();
    const text = '<img src=x onerror=alert(1)>';
    const c = await comment(bea.client, pageId, { body: text });
    expect(c.body).toBe(text);
    const [t] = await list(bea.client, pageId);
    expect(t.body).toBe(text);
  });

  it('comment actions never change the page, its version or its history; a restore leaves comments alone', async () => {
    const { ada, bea, val, pageId, blocks } = await setup();
    const start = await pageState(pageId);

    const root = await comment(bea.client, pageId, { body: 'On a block', blockId: blocks[0] });
    const reply = await comment(val.client, pageId, { body: 'Reply', parentId: root.id });
    expect((await bea.client.patch(`/api/comments/${root.id}`, { body: 'Edited' })).status).toBe(200);
    expect((await bea.client.post(`/api/comments/${root.id}/resolve`)).status).toBe(200);
    expect((await bea.client.post(`/api/comments/${root.id}/reopen`)).status).toBe(200);
    expect((await val.client.del(`/api/comments/${reply.id}`)).status).toBe(204);
    expect(await pageState(pageId)).toEqual(start);

    // Bea saves a new version (a new snapshot, since Ada made version 1), then Ada restores version 1.
    const page = (await bea.client.get(`/api/pages/${pageId}`)).body.page;
    const saved = await bea.client.put(`/api/pages/${pageId}`, { baseVersion: page.version, title: 'Runbook v2' });
    expect(saved.status).toBe(200);
    const commentsBefore = (await ctx.pool.query('select * from page_comments where page_id = $1 order by id', [pageId])).rows;
    const restored = await ada.client.post(`/api/pages/${pageId}/versions/1/restore`, { baseVersion: saved.body.version });
    expect(restored.status).toBe(200);
    const commentsAfter = (await ctx.pool.query('select * from page_comments where page_id = $1 order by id', [pageId])).rows;
    expect(commentsAfter).toEqual(commentsBefore);
    expect(commentsAfter).toHaveLength(2);
  });

  it('signed out: 401 on every route', async () => {
    const { bea, pageId } = await setup();
    const c = await comment(bea.client, pageId, { body: 'Hello' });
    const anon = new Client(ctx.app);
    expect((await anon.get(`/api/pages/${pageId}/comments`)).status).toBe(401);
    expect((await anon.post(`/api/pages/${pageId}/comments`, { body: 'hi' })).status).toBe(401);
    expect((await anon.patch(`/api/comments/${c.id}`, { body: 'hi' })).status).toBe(401);
    expect((await anon.del(`/api/comments/${c.id}`)).status).toBe(401);
    expect((await anon.post(`/api/comments/${c.id}/resolve`)).status).toBe(401);
    expect((await anon.post(`/api/comments/${c.id}/reopen`)).status).toBe(401);
  });
});
