// Mentions, following and notifications, server side
// (docs/done-checks/15-mentions.md, "15a — Server"): the mention node, who is
// told and when, folding edits, following, the read filter (live pages in
// visibleSpaceIds), only your own, and 401 signed out. Real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';
import { docMentions, getDocSchema, nodeToText, parseDoc } from '@stillwater/editor-schema';

let ctx: TestCtx;
let w: Awaited<ReturnType<typeof world>>;

// Signups are rate-limited per address, so the people are made once for the file.
beforeAll(async () => {
  ctx = await setupApp({ AI_PROVIDER: 'stub' });
  await ctx.reset();
  w = await world();
});
afterAll(async () => {
  await ctx.close();
});

/**
 * Ada is the instance admin. Sam makes the restricted space "eng" (Bo an
 * editor, Vi a viewer, Di a member who is then disabled), the restricted space
 * "rr" (Bo an editor, Wu a viewer) and the open space "pub". Nm is in no
 * restricted space. In "pub" everyone else is a viewer (its default role).
 */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const sam = await signup(ctx.app, 'Sam');
  const bo = await signup(ctx.app, 'Bo');
  const vi = await signup(ctx.app, 'Vi');
  const nm = await signup(ctx.app, 'Nm');
  const di = await signup(ctx.app, 'Di');
  const wu = await signup(ctx.app, 'Wu');
  for (const [key, name, visibility] of [
    ['eng', 'Engineering', 'restricted'],
    ['rr', 'Research', 'restricted'],
    ['pub', 'Public', 'open'],
  ] as const) {
    expect((await sam.client.post('/api/spaces', { key, name, visibility })).status).toBe(201);
  }
  await sam.client.put(`/api/spaces/eng/members/${bo.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${vi.user.id}`, { role: 'viewer' });
  await sam.client.put(`/api/spaces/eng/members/${di.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/rr/members/${bo.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/rr/members/${wu.user.id}`, { role: 'viewer' });
  expect((await ada.client.patch(`/api/users/${di.user.id}`, { disabled: true })).status).toBe(200);
  return { ada, sam, bo, vi, nm, di, wu };
}

type Person = Awaited<ReturnType<typeof signup>>;

const NOBODY = '0b7e1c2d-3f4a-4b5c-8d6e-7f8091a2b3c4';
const text = (t: string) => ({ type: 'text', text: t });
const mention = (userId: string, label = 'Someone') => ({ type: 'mention', attrs: { userId, label } });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
/** A one-paragraph doc mentioning these people. */
const mentioning = (...people: Person[]) =>
  doc(para(text('Hello '), ...people.flatMap((p) => [mention(p.user.id, 'P'), text(' ')])));

async function makePage(c: Client, key: string, title: string, body?: unknown, parentId: string | null = null) {
  const res = await c.post(`/api/spaces/${key}/pages`, { title, parentId, ...(body ? { doc: body } : {}) });
  expect(res.status).toBe(201);
  return res.body.page.id as string;
}

/** Save a doc (and/or title) on top of the current version; returns the reply. */
async function save(c: Client, id: string, change: { doc?: unknown; title?: string }) {
  const { version } = (await c.get(`/api/pages/${id}`)).body.page;
  return c.put(`/api/pages/${id}`, { baseVersion: version, ...change });
}

type Note = {
  id: string;
  kind: 'mention' | 'comment' | 'edit';
  page: { id: string; title: string; space: { key: string; name: string } };
  actor: { id: string; name: string } | null;
  commentId: string | null;
  count: number;
  createdAt: string;
  readAt: string | null;
};

/** Every notification of the person, all pages of the list. */
async function allNotes(c: Client): Promise<Note[]> {
  const out: Note[] = [];
  let before = '';
  for (;;) {
    const res = await c.get(`/api/me/notifications${before ? `?before=${before}` : ''}`);
    expect(res.status).toBe(200);
    out.push(...res.body.notifications);
    if (!res.body.more) return out;
    before = out.at(-1)!.id;
  }
}
const notesOn = async (c: Client, pageId: string) => (await allNotes(c)).filter((n) => n.page.id === pageId);
const unread = async (c: Client) => {
  const res = await c.get('/api/me/notifications/unread');
  expect(res.status).toBe(200);
  return res.body.count as number;
};
const readAll = async (c: Client) => expect((await c.post('/api/me/notifications/read', { all: true })).body).toEqual({ count: 0 });

describe('the mention node', () => {
  const B = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b';

  it('round-trips through JSON and HTML with the same userId and label, and reads as @label in plain text', () => {
    const json = parseDoc(doc(para(text('Ask '), mention(B, 'Vi Lane'), text(' please')))).toJSON();
    const m = json.content[0].content[1];
    expect(m).toEqual({ type: 'mention', attrs: { userId: B, label: 'Vi Lane' } });
    expect(parseDoc(json).toJSON()).toEqual(json);

    const schema = getDocSchema();
    const node = schema.nodeFromJSON(m);
    const [tag, attrs, inner] = schema.nodes.mention!.spec.toDOM!(node) as unknown as [string, Record<string, string>, string];
    expect(tag).toBe('span');
    expect(attrs).toMatchObject({ 'data-mention': '', 'data-user-id': B });
    expect(inner).toBe('@Vi Lane');
    // Read the rendered span back through the schema's own HTML rule.
    const rule = schema.nodes.mention!.spec.parseDOM![0]!;
    expect(rule.tag).toBe('span[data-mention]');
    const el = (id: string) => ({ getAttribute: (n: string) => ({ ...attrs, 'data-user-id': id })[n] ?? null, textContent: inner });
    expect((rule as { getAttrs: (e: unknown) => unknown }).getAttrs(el(B))).toEqual({ userId: B, label: 'Vi Lane' });
    expect((rule as { getAttrs: (e: unknown) => unknown }).getAttrs(el('not-a-uuid'))).toBe(false);

    expect(nodeToText(parseDoc(json))).toBe('Ask @Vi Lane please');
  });

  it('docMentions finds mentions in a paragraph, a list, a table cell and a task item', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => `${x.repeat(8)}-0000-4000-8000-000000000000`);
    const parsed = parseDoc(
      doc(
        para(mention(a!)),
        { type: 'bulletList', content: [{ type: 'listItem', content: [para(mention(b!))] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(mention(c!))] }] }] },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [para(text('do '), mention(d!.toUpperCase()), mention(a!))] }],
        },
      ),
    );
    expect(docMentions(parsed)).toEqual(new Set([a, b, c, d]));
    expect(docMentions(parsed.toJSON())).toEqual(new Set([a, b, c, d]));
  });

  it('a userId that is not a uuid, or none, is a 400 on save; the plain text kept for search has @label', async () => {
    const id = await makePage(w.bo.client, 'eng', 'Node check');
    for (const bad of [{ type: 'mention', attrs: { userId: 'vi', label: 'Vi' } }, { type: 'mention', attrs: { label: 'Vi' } }]) {
      const res = await save(w.bo.client, id, { doc: doc(para(bad)) });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/mention/);
    }
    expect((await save(w.bo.client, id, { doc: doc(para(text('Hi '), mention(w.vi.user.id, 'Vi'))) })).status).toBe(200);
    const { rows } = await ctx.pool.query('select doc_text from pages where id = $1', [id]);
    expect(rows[0].doc_text).toBe('Hi @Vi');
  });
});

describe('suggestions for @', () => {
  it('in a restricted space, the people list has members and instance admins, never a non-member or a disabled person', async () => {
    const res = await w.bo.client.get('/api/spaces/eng/people');
    expect(res.status).toBe(200);
    const ids = res.body.people.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([w.ada.user.id, w.sam.user.id, w.bo.user.id, w.vi.user.id]));
    expect(ids).not.toContain(w.nm.user.id);
    expect(ids).not.toContain(w.di.user.id);
    expect((await w.bo.client.get('/api/spaces/eng/people?q=nm')).body.people).toEqual([]);
  });
});

describe('mentions', () => {
  it('a newly mentioned person is told once; the same doc again tells nobody; remove and add back tells again', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Pruning guide');
    expect((await save(bo.client, id, { doc: mentioning(vi) })).status).toBe(200);
    let notes = await notesOn(vi.client, id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: 'mention',
      page: { id, title: 'Pruning guide', space: { key: 'eng', name: 'Engineering' } },
      actor: { id: bo.user.id, name: 'Bo' },
      commentId: null,
      count: 1,
      readAt: null,
    });

    expect((await save(bo.client, id, { doc: mentioning(vi) })).status).toBe(200);
    expect((await save(bo.client, id, { title: 'Pruning guide' })).status).toBe(200);
    expect(await notesOn(vi.client, id)).toHaveLength(1);

    expect((await save(bo.client, id, { doc: doc(para(text('nobody'))) })).status).toBe(200);
    expect((await save(bo.client, id, { doc: mentioning(vi) })).status).toBe(200);
    notes = await notesOn(vi.client, id);
    expect(notes.map((n) => n.kind)).toEqual(['mention', 'mention']);
  });

  it('mentioning yourself, a non-member of a restricted space, or nobody saves fine and tells no one', async () => {
    const { bo, nm } = w;
    const id = await makePage(bo.client, 'eng', 'Quiet page');
    const res = await save(bo.client, id, { doc: doc(para(mention(bo.user.id, 'Bo'), mention(nm.user.id, 'Nm'), mention(NOBODY, 'Ghost'))) });
    expect(res.status).toBe(200);
    // The doc keeps them as sent.
    const kept = docMentions((await bo.client.get(`/api/pages/${id}`)).body.page.doc);
    expect(kept).toEqual(new Set([bo.user.id, nm.user.id, NOBODY]));
    const { rows } = await ctx.pool.query('select count(*)::int as n from notifications where page_id = $1', [id]);
    expect(rows[0].n).toBe(0);
  });

  it('a page made with a mention in its first doc tells that person', async () => {
    const id = await makePage(w.bo.client, 'eng', 'Born with a mention', mentioning(w.vi));
    expect((await notesOn(w.vi.client, id)).map((n) => n.kind)).toEqual(['mention']);
  });

  it('a history restore that brings a mention back tells them', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Restore me', mentioning(vi));
    // Saved by someone else, so it is its own snapshot and version 1 stays in history.
    expect((await save(w.ada.client, id, { doc: doc(para(text('gone'))) })).status).toBe(200);
    expect(await notesOn(vi.client, id)).toHaveLength(1);
    const { version } = (await bo.client.get(`/api/pages/${id}`)).body.page;
    const res = await bo.client.post(`/api/pages/${id}/versions/1/restore`, { baseVersion: version });
    expect(res.status).toBe(200);
    expect((await notesOn(vi.client, id)).map((n) => n.kind)).toEqual(['mention', 'mention']);
  });

  it('a disabled person is never told', async () => {
    const id = await makePage(w.bo.client, 'eng', 'Disabled check', doc(para(mention(w.di.user.id, 'Di'))));
    const { rows } = await ctx.pool.query('select count(*)::int as n from notifications where page_id = $1', [id]);
    expect(rows[0].n).toBe(0);
  });
});

describe('following', () => {
  it('the creator follows a new page; others do not until they follow or comment', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Followed');
    expect((await bo.client.get(`/api/pages/${id}`)).body.page.following).toBe(true);
    expect((await vi.client.get(`/api/pages/${id}`)).body.page.following).toBe(false);
    expect((await vi.client.post(`/api/pages/${id}/comments`, { body: 'Nice' })).status).toBe(201);
    expect((await vi.client.get(`/api/pages/${id}`)).body.page.following).toBe(true);
  });

  it('PUT and DELETE work twice with no change; a viewer can follow; a non-member gets 404', async () => {
    const { bo, vi, nm } = w;
    const id = await makePage(bo.client, 'eng', 'Follow twice');
    for (let i = 0; i < 2; i++) {
      const res = await vi.client.put(`/api/pages/${id}/follow`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true });
    }
    expect((await vi.client.get(`/api/pages/${id}`)).body.page.following).toBe(true);
    for (let i = 0; i < 2; i++) {
      const res = await vi.client.del(`/api/pages/${id}/follow`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: false });
    }
    expect((await vi.client.get(`/api/pages/${id}`)).body.page.following).toBe(false);
    expect((await nm.client.put(`/api/pages/${id}/follow`)).status).toBe(404);
    expect((await nm.client.del(`/api/pages/${id}/follow`)).status).toBe(404);
    expect((await nm.client.put('/api/pages/not-a-uuid/follow')).status).toBe(404);
    const { rows } = await ctx.pool.query('select count(*)::int as n from page_follows where page_id = $1', [id]);
    expect(rows[0].n).toBe(1); // only Bo, the creator
  });

  it('commenting does not undo a later unfollow', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Unfollow sticks');
    await vi.client.post(`/api/pages/${id}/comments`, { body: 'one' });
    await vi.client.del(`/api/pages/${id}/follow`);
    expect((await vi.client.get(`/api/pages/${id}`)).body.page.following).toBe(false);
    // A new comment follows again (insert if missing), as the done-check says.
    await vi.client.post(`/api/pages/${id}/comments`, { body: 'two' });
    expect((await vi.client.get(`/api/pages/${id}`)).body.page.following).toBe(true);
  });
});

describe('comments and edits', () => {
  it('a follower is told about a comment and a reply by someone else, never their own', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Talk page');
    await vi.client.put(`/api/pages/${id}/follow`);
    const root = await bo.client.post(`/api/pages/${id}/comments`, { body: 'First' });
    expect(root.status).toBe(201);
    const reply = await bo.client.post(`/api/pages/${id}/comments`, { body: 'Reply', parentId: root.body.comment.id });
    expect(reply.status).toBe(201);
    const own = await vi.client.post(`/api/pages/${id}/comments`, { body: 'Mine', parentId: root.body.comment.id });
    expect(own.status).toBe(201);

    const notes = await notesOn(vi.client, id);
    expect(notes.map((n) => [n.kind, n.actor?.name])).toEqual([
      ['comment', 'Bo'],
      ['comment', 'Bo'],
    ]);
    const commentIds = (x: { body: any }) => x.body.comment.id;
    expect(new Set(notes.map((n) => n.commentId))).toEqual(new Set([commentIds(root), commentIds(reply)]));
    // Bo follows as the creator and is told about Vi's reply, not about his own.
    expect((await notesOn(bo.client, id)).map((n) => [n.kind, n.actor?.name, n.commentId])).toEqual([['comment', 'Vi', commentIds(own)]]);
  });

  it('three saves by someone else fold into one edit with count 3 and the newest time; after reading, the next save starts a new one', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Busy page');
    await vi.client.put(`/api/pages/${id}/follow`);
    await save(bo.client, id, { doc: doc(para(text('one'))) });
    const first = (await notesOn(vi.client, id))[0]!;
    await save(bo.client, id, { doc: doc(para(text('two'))) });
    await save(bo.client, id, { title: 'Busy page 3' });
    let notes = await notesOn(vi.client, id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: first.id, kind: 'edit', count: 3, actor: { id: bo.user.id }, page: { title: 'Busy page 3' } });
    expect(new Date(notes[0]!.createdAt).getTime()).toBeGreaterThan(new Date(first.createdAt).getTime());

    expect((await vi.client.post('/api/me/notifications/read', { ids: [first.id] })).status).toBe(200);
    await save(bo.client, id, { doc: doc(para(text('four'))) });
    notes = await notesOn(vi.client, id);
    expect(notes.map((n) => [n.kind, n.count, n.readAt === null])).toEqual([
      ['edit', 1, true],
      ['edit', 3, false],
    ]);
    // Bo is never told about his own saves.
    expect(await notesOn(bo.client, id)).toEqual([]);
  });

  it('a task tick by someone else tells followers like any edit', async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Tick page', {
      type: 'doc',
      content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, taskId: 't1' }, content: [para(text('Do it'))] }] }],
    });
    await vi.client.put(`/api/pages/${id}/follow`);
    expect((await bo.client.patch(`/api/pages/${id}/tasks/t1`, { checked: true })).status).toBe(200);
    expect((await notesOn(vi.client, id)).map((n) => [n.kind, n.actor?.name])).toEqual([['edit', 'Bo']]);
  });

  it('a save never changes when a notification is written: version and history are the same with and without followers', async () => {
    const { bo, vi, ada } = w;
    const loud = await makePage(bo.client, 'eng', 'Loud', mentioning(vi));
    const quiet = await makePage(bo.client, 'eng', 'Quiet', mentioning(vi));
    await vi.client.put(`/api/pages/${loud}/follow`);
    await ada.client.put(`/api/pages/${loud}/follow`);
    await bo.client.del(`/api/pages/${quiet}/follow`);
    for (const id of [loud, quiet]) {
      await save(bo.client, id, { doc: doc(para(text('a'))) });
      await save(bo.client, id, { doc: mentioning(vi, ada) });
      await save(bo.client, id, { title: 'Same' });
    }
    const facts = async (id: string) => {
      const page = (await bo.client.get(`/api/pages/${id}`)).body.page;
      const { rows } = await ctx.pool.query('select version, restored_from from page_versions where page_id = $1 order by version', [id]);
      return { version: page.version, history: rows };
    };
    expect(await facts(loud)).toEqual(await facts(quiet));
    const { rows } = await ctx.pool.query(
      `select p.id, count(n.*)::int as n from pages p left join notifications n on n.page_id = p.id and n.kind = 'edit' where p.id in ($1, $2) group by p.id`,
      [loud, quiet],
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.n]))).toEqual({ [loud]: 2, [quiet]: 0 });
  });
});

describe('never from pages you cannot see', () => {
  /** Wu's view: is this page in the list, how many unread in the list, and the count. They must agree. */
  async function view(pageIds: string[]) {
    const notes = await allNotes(w.wu.client);
    const count = await unread(w.wu.client);
    expect(count).toBe(notes.filter((n) => n.readAt === null).length);
    return { shown: pageIds.map((id) => notes.some((n) => n.page.id === id)), count };
  }

  it('losing access, trash and restore of the page, its parent or the space, purge and a deleted comment: list and count agree', async () => {
    const { bo, sam, wu } = w;
    await readAll(wu.client);
    const parent = await makePage(bo.client, 'rr', 'Parent');
    const child = await makePage(bo.client, 'rr', 'Child', mentioning(wu), parent);
    expect(await view([child])).toEqual({ shown: [true], count: 1 });

    // Losing access hides it at once; getting it back brings it back.
    expect((await sam.client.del(`/api/spaces/rr/members/${wu.user.id}`)).status).toBeLessThan(300);
    expect(await view([child])).toEqual({ shown: [false], count: 0 });
    await sam.client.put(`/api/spaces/rr/members/${wu.user.id}`, { role: 'viewer' });
    expect(await view([child])).toEqual({ shown: [true], count: 1 });

    // Trash the page itself, then its parent, then the space.
    expect((await bo.client.del(`/api/pages/${child}`)).status).toBeLessThan(300);
    expect(await view([child])).toEqual({ shown: [false], count: 0 });
    expect((await bo.client.post(`/api/pages/${child}/restore`)).status).toBe(200);
    expect(await view([child])).toEqual({ shown: [true], count: 1 });

    expect((await bo.client.del(`/api/pages/${parent}`)).status).toBeLessThan(300);
    expect(await view([child])).toEqual({ shown: [false], count: 0 });
    expect((await bo.client.post(`/api/pages/${parent}/restore`)).status).toBe(200);
    expect(await view([child])).toEqual({ shown: [true], count: 1 });

    const spaceId = (await sam.client.get('/api/spaces/rr')).body.space.id as string;
    expect((await sam.client.del('/api/spaces/rr')).status).toBeLessThan(300);
    expect(await view([child])).toEqual({ shown: [false], count: 0 });
    expect((await sam.client.post(`/api/trash/spaces/${spaceId}/restore`)).status).toBe(200);
    expect(await view([child])).toEqual({ shown: [true], count: 1 });

    // A deleted comment's notification is hidden.
    await wu.client.put(`/api/pages/${parent}/follow`);
    const c = await bo.client.post(`/api/pages/${parent}/comments`, { body: 'Look' });
    const commentId = c.body.comment.id;
    expect(await view([child, parent])).toEqual({ shown: [true, true], count: 2 });
    expect((await bo.client.del(`/api/comments/${commentId}`)).status).toBeLessThan(300);
    expect(await view([child, parent])).toEqual({ shown: [true, false], count: 1 });

    // Purging removes the rows.
    expect((await bo.client.del(`/api/pages/${child}`)).status).toBeLessThan(300);
    expect((await sam.client.del(`/api/pages/${child}/purge`)).status).toBe(204);
    const { rows } = await ctx.pool.query('select count(*)::int as n from notifications where page_id = $1', [child]);
    expect(rows[0].n).toBe(0);
    expect(await view([child, parent])).toEqual({ shown: [false, false], count: 0 });
  });
});

describe('only your own', () => {
  it("someone else's id is ignored or 404; nobody lists anyone else's; all marks only yours", async () => {
    const { bo, vi } = w;
    const id = await makePage(bo.client, 'eng', 'Mine only');
    await save(bo.client, id, { doc: mentioning(vi) });
    await vi.client.put(`/api/pages/${id}/follow`);
    await save(bo.client, id, { title: 'Mine only 2' });
    const [edit, men] = await notesOn(vi.client, id);
    expect([edit!.kind, men!.kind]).toEqual(['edit', 'mention']);

    // Bo cannot mark Vi's as read: 404 when none are his, ignored when mixed in.
    expect((await bo.client.post('/api/me/notifications/read', { ids: [men!.id] })).status).toBe(404);
    await readAll(bo.client);
    await vi.client.post(`/api/pages/${id}/comments`, { body: 'for Bo' });
    const bos = (await notesOn(bo.client, id))[0]!;
    const mixed = await bo.client.post('/api/me/notifications/read', { ids: [bos.id, men!.id] });
    expect(mixed.status).toBe(200);
    expect(mixed.body).toEqual({ count: 0 });
    expect((await notesOn(vi.client, id)).every((n) => n.readAt === null)).toBe(true);
    // Bo's list never holds Vi's notifications, and a cursor that is not his is refused.
    expect((await allNotes(bo.client)).some((n) => n.id === men!.id || n.id === edit!.id)).toBe(false);
    expect((await bo.client.get(`/api/me/notifications?before=${men!.id}`)).status).toBe(400);

    // { all: true } by Bo leaves Vi's unread.
    const viUnread = await unread(vi.client);
    expect(viUnread).toBeGreaterThan(0);
    await readAll(bo.client);
    expect(await unread(vi.client)).toBe(viUnread);
    const left = await vi.client.post('/api/me/notifications/read', { ids: [men!.id] });
    expect(left.body).toEqual({ count: viUnread - 1 });
    // Bad bodies are 400.
    for (const body of [{}, { ids: [] }, { ids: ['x'] }, { all: false }, { all: true, ids: [men!.id] }]) {
      expect((await vi.client.post('/api/me/notifications/read', body)).status).toBe(400);
    }
  });

  it('paging with before gives each notification once, newest first', async () => {
    const { bo, nm, sam } = w;
    const id = await makePage(sam.client, 'pub', 'Many comments');
    await nm.client.put(`/api/pages/${id}/follow`);
    for (let i = 0; i < 35; i++) expect((await bo.client.post(`/api/pages/${id}/comments`, { body: `c${i}` })).status).toBe(201);
    const first = await nm.client.get('/api/me/notifications');
    expect(first.body.notifications).toHaveLength(30);
    expect(first.body.more).toBe(true);
    const all = await allNotes(nm.client);
    const ids = all.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.filter((n) => n.page.id === id)).toHaveLength(35);
    const times = all.map((n) => new Date(n.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await unread(nm.client)).toBe(all.filter((n) => n.readAt === null).length);
  });
});

describe('signed out', () => {
  it('is 401 on every route', async () => {
    const anon = new Client(ctx.app);
    const id = await makePage(w.sam.client, 'pub', 'Anon');
    for (const [method, url, body] of [
      ['GET', '/api/me/notifications', undefined],
      ['GET', '/api/me/notifications/unread', undefined],
      ['POST', '/api/me/notifications/read', { all: true }],
      ['PUT', `/api/pages/${id}/follow`, {}],
      ['DELETE', `/api/pages/${id}/follow`, undefined],
    ] as const) {
      expect((await anon.req(method, url, body)).status, `${method} ${url}`).toBe(401);
    }
  });
});
