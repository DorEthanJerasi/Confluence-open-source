// Page locks, server side (docs/done-checks/17-locks.md, "17a — Server"):
// who may lock and unlock, no-op and no trace, the lock on GET, read-only for
// everyone through savePage (save, restore, task ticks, the race), trash,
// templates, and what a lock does not stop. Real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';
import { savePage } from '../src/pages/pages.js';
import { tickTask } from '../src/tasks/tasks.js';
import type { SessionUser } from '../src/auth/session.js';

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

type Person = Awaited<ReturnType<typeof signup>>;

/**
 * Ada is the instance admin. Sam makes the restricted space "eng" (Bo and Cy
 * editors, Vi a viewer) and the restricted space "ops" (Sam only). Nm is
 * signed in and in no restricted space. Anon is signed out.
 */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const sam = await signup(ctx.app, 'Sam');
  const bo = await signup(ctx.app, 'Bo');
  const cy = await signup(ctx.app, 'Cy');
  const vi = await signup(ctx.app, 'Vi');
  const nm = await signup(ctx.app, 'Nm');
  expect(ada.user.role).toBe('admin');
  for (const key of ['eng', 'ops']) {
    expect((await sam.client.post('/api/spaces', { key, name: key.toUpperCase(), visibility: 'restricted' })).status).toBe(201);
  }
  await sam.client.put(`/api/spaces/eng/members/${bo.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${cy.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${vi.user.id}`, { role: 'viewer' });
  return { ada, sam, bo, cy, vi, nm, anon: new Client(ctx.app) };
}

const p = (text: string, id = `b-${text}`) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const doc = (...texts: string[]) => ({ type: 'doc' as const, content: texts.map((t) => p(t)) });

async function makePage(c: Client, title: string, opts: { doc?: unknown; key?: string; parentId?: string | null } = {}) {
  const res = await c.post(`/api/spaces/${opts.key ?? 'eng'}/pages`, { title, parentId: opts.parentId ?? null });
  expect(res.status).toBe(201);
  const id = res.body.page.id as string;
  if (opts.doc) expect((await c.put(`/api/pages/${id}`, { baseVersion: 1, doc: opts.doc })).status).toBe(200);
  return id;
}

const getPage = async (who: Client | Person, id: string) => {
  const c = who instanceof Client ? who : who.client;
  const res = await c.get(`/api/pages/${id}`);
  expect(res.status).toBe(200);
  return res.body.page;
};
const lock = (who: Person, id: string) => who.client.post(`/api/pages/${id}/lock`);
const unlock = (who: Person, id: string) => who.client.post(`/api/pages/${id}/unlock`);

/** The page row as stored, for "nothing changed" checks. */
async function row(id: string) {
  const res = await ctx.pool.query(
    `select version, updated_at, updated_by, doc, doc_text, title, locked_at, locked_by, deleted_at,
       (select count(*)::int from page_versions v where v.page_id = pages.id) as versions
     from pages where id = $1`,
    [id],
  );
  return res.rows[0];
}
const notificationCount = async () => (await ctx.pool.query('select count(*)::int as n from notifications')).rows[0].n as number;

const lockedMessage = (name: string) => `This page is locked by ${name}. Unlock it to make changes.`;
const sessionUser = (who: Person, name: string): SessionUser => ({
  id: who.user.id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  role: who.user.role as SessionUser['role'],
});

describe('who may lock and unlock', () => {
  it('editors, space admins and instance admins can; viewers 403; outsiders 404; signed out 401', async () => {
    const id = await makePage(w.sam.client, 'Who');

    const a = await lock(w.bo, id);
    expect(a.status).toBe(200);
    expect(a.body.lock.by).toEqual({ id: w.bo.user.id, name: 'Bo' });
    expect(typeof a.body.lock.at).toBe('string');
    // Any editor can unlock a page another editor locked.
    const b = await unlock(w.cy, id);
    expect(b.status).toBe(200);
    expect(b.body.lock).toBeNull();

    expect((await lock(w.sam, id)).body.lock.by.id).toBe(w.sam.user.id);
    expect((await unlock(w.ada, id)).status).toBe(200);
    expect((await lock(w.ada, id)).body.lock.by.id).toBe(w.ada.user.id);
    expect((await unlock(w.sam, id)).body.lock).toBeNull();

    for (const fn of [lock, unlock]) {
      const v = await fn(w.vi, id);
      expect(v.status).toBe(403);
      expect((await fn(w.nm, id)).status).toBe(404);
      expect((await w.anon.post(`/api/pages/${id}/${fn === lock ? 'lock' : 'unlock'}`)).status).toBe(401);
    }
    expect((await getPage(w.vi, id)).lock).toBeNull();
    expect((await lock(w.bo, 'not-a-uuid')).status).toBe(404);

    const gone = await makePage(w.sam.client, 'Gone');
    expect((await w.sam.client.del(`/api/pages/${gone}`)).status).toBe(200);
    expect((await lock(w.bo, gone)).status).toBe(404);
    expect((await unlock(w.bo, gone)).status).toBe(404);
    expect((await ctx.pool.query('select locked_at from pages where id = $1', [gone])).rows[0].locked_at).toBeNull();
  });
});

describe('no-op and no trace', () => {
  it('locking twice and unlocking twice answer the state; no version, document, history or notification', async () => {
    const id = await makePage(w.sam.client, 'Quiet', { doc: doc('one', 'two') });
    expect((await w.cy.client.put(`/api/pages/${id}/follow`)).status).toBe(200);
    const before = await row(id);
    const notes = await notificationCount();

    const first = await lock(w.bo, id);
    const locked = await row(id);
    const second = await lock(w.cy, id);
    expect(second.status).toBe(200);
    expect(second.body.lock).toEqual(first.body.lock);
    expect((await row(id)).locked_at).toEqual(locked.locked_at);
    expect((await row(id)).locked_by).toBe(w.bo.user.id);

    expect((await unlock(w.cy, id)).body.lock).toBeNull();
    const again = await unlock(w.bo, id);
    expect(again.status).toBe(200);
    expect(again.body.lock).toBeNull();

    const after = await row(id);
    for (const col of ['version', 'updated_at', 'updated_by', 'doc', 'doc_text', 'title', 'versions'] as const) {
      expect(after[col]).toEqual(before[col]);
    }
    expect(after.locked_at).toBeNull();
    expect(after.locked_by).toBeNull();
    expect(await notificationCount()).toBe(notes);
  });
});

describe('GET /api/pages/:id shows the lock', () => {
  it('with the locker, null after unlock, and by null once the locker is gone (still locked)', async () => {
    const id = await makePage(w.sam.client, 'Shown');
    expect((await getPage(w.vi, id)).lock).toBeNull();
    const { body } = await lock(w.bo, id);
    const seen = await getPage(w.vi, id);
    expect(seen.lock).toEqual({ at: body.lock.at, by: { id: w.bo.user.id, name: 'Bo' } });
    expect(new Date(seen.lock.at).getTime()).toBe(new Date((await row(id)).locked_at).getTime());
    await unlock(w.bo, id);
    expect((await getPage(w.vi, id)).lock).toBeNull();

    // A person who locks a page and whose user row is then removed.
    const lo = await signup(ctx.app, 'Lo');
    await w.sam.client.put(`/api/spaces/eng/members/${lo.user.id}`, { role: 'editor' });
    const at = (await lock(lo, id)).body.lock.at;
    await ctx.pool.query('delete from users where id = $1', [lo.user.id]);
    const after = await getPage(w.vi, id);
    expect(after.lock).toEqual({ at, by: null });
    const save = await w.bo.client.put(`/api/pages/${id}`, { baseVersion: after.version, title: 'Nope' });
    expect(save.status).toBe(423);
    expect(save.body).toEqual({ error: 'page_locked', message: 'This page is locked. Unlock it to make changes.' });
    expect((await unlock(w.bo, id)).body.lock).toBeNull();
  });
});

describe('read-only for everyone', () => {
  it('the locker, another editor, the space admin and the instance admin all get 423; after unlock the same save works', async () => {
    const id = await makePage(w.sam.client, 'Frozen', { doc: doc('kept') });
    const before = await row(id);
    await lock(w.bo, id);
    const change = { baseVersion: before.version, title: 'Changed', doc: doc('changed') };
    for (const who of [w.bo, w.cy, w.sam, w.ada]) {
      const res = await who.client.put(`/api/pages/${id}`, change);
      expect(res.status).toBe(423);
      expect(res.body).toEqual({ error: 'page_locked', message: lockedMessage('Bo') });
    }
    // A stale base on a locked page still says "locked": unlocking is the next step either way.
    expect((await w.cy.client.put(`/api/pages/${id}`, { ...change, baseVersion: 1 })).status).toBe(423);
    const still = await row(id);
    for (const col of ['version', 'updated_at', 'doc', 'title', 'versions'] as const) expect(still[col]).toEqual(before[col]);
    // The viewer is refused by the permission check first, as before.
    expect((await w.vi.client.put(`/api/pages/${id}`, change)).status).toBe(403);

    await unlock(w.cy, id);
    const ok = await w.cy.client.put(`/api/pages/${id}`, change);
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(before.version + 1);
    // 409 and 404 work as before.
    expect((await w.cy.client.put(`/api/pages/${id}`, change)).status).toBe(409);
    await w.cy.client.del(`/api/pages/${id}`);
    expect(await savePage(ctx.db, id, { title: 'x' }, ok.body.version, w.cy.user.id).catch((e) => e.status)).toBe(404);
  });

  it('a save that read the page before a lock and updates after it gets 423, not a version', async () => {
    const id = await makePage(w.sam.client, 'Race', { doc: doc('race') });
    const before = await row(id);
    const err = await savePage(ctx.db, id, { doc: doc('slipped') }, before.version, w.cy.user.id, {
      hooks: {
        beforeUpdate: async () => {
          expect((await lock(w.bo, id)).status).toBe(200);
        },
      },
    }).catch((e) => e);
    expect(err.status).toBe(423);
    expect(err.code).toBe('page_locked');
    const after = await row(id);
    expect(after.version).toBe(before.version);
    expect(after.versions).toBe(before.versions);
    expect(after.doc_text).toBe(before.doc_text);
    await unlock(w.bo, id);

    // The same through a task tick: the page is read, then locked, then saved.
    const tid = await makePage(w.sam.client, 'Race tick', { doc: taskDoc() });
    const page = await getPage(w.bo, tid);
    const taskId = taskIdsOf(page.doc)[0]!;
    const tickErr = await tickTask(ctx.db, sessionUser(w.cy, 'Cy'), tid, taskId, true, {
      beforeSave: async () => {
        expect((await lock(w.bo, tid)).status).toBe(200);
      },
    }).catch((e) => e);
    expect(tickErr.status).toBe(423);
    expect((await row(tid)).version).toBe(page.version);
    await unlock(w.bo, tid);
  });
});

const taskDoc = () => ({
  type: 'doc',
  content: [
    p('intro'),
    {
      type: 'taskList',
      attrs: { id: 'list-1' },
      content: [{ type: 'taskItem', attrs: { checked: false, taskId: null, assignee: null, due: null }, content: [p('Pay the bill')] }],
    },
  ],
});
function taskIdsOf(d: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n?.type === 'taskItem') out.push(n.attrs.taskId);
    (n?.content ?? []).forEach(walk);
  };
  walk(d);
  return out;
}

describe('restore and tasks go through the lock', () => {
  it('versions can be listed and read on a locked page; restore is 423 and writes nothing; after unlock it works', async () => {
    const id = await makePage(w.sam.client, 'History', { doc: doc('first') });
    const v2 = (await w.bo.client.put(`/api/pages/${id}`, { baseVersion: 2, doc: doc('second') })).body.version;
    expect(v2).toBe(3);
    await lock(w.cy, id);
    const list = await w.vi.client.get(`/api/pages/${id}/versions`);
    expect(list.status).toBe(200);
    expect(list.body.versions.length).toBeGreaterThanOrEqual(2);
    expect((await w.vi.client.get(`/api/pages/${id}/versions/2`)).status).toBe(200);

    const before = await row(id);
    const res = await w.bo.client.post(`/api/pages/${id}/versions/2/restore`, { baseVersion: 3 });
    expect(res.status).toBe(423);
    expect(res.body).toEqual({ error: 'page_locked', message: lockedMessage('Cy') });
    const after = await row(id);
    for (const col of ['version', 'doc', 'versions', 'updated_at'] as const) expect(after[col]).toEqual(before[col]);

    await unlock(w.bo, id);
    const ok = await w.bo.client.post(`/api/pages/${id}/versions/2/restore`, { baseVersion: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(4);
  });

  it('ticking a task on a locked page is 423 and the doc is unchanged', async () => {
    const id = await makePage(w.sam.client, 'Tasks', { doc: taskDoc() });
    const page = await getPage(w.bo, id);
    const taskId = taskIdsOf(page.doc)[0]!;
    await lock(w.sam, id);
    const res = await w.bo.client.patch(`/api/pages/${id}/tasks/${taskId}`, { checked: true });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe('page_locked');
    const after = await getPage(w.bo, id);
    expect(after.doc).toEqual(page.doc);
    expect(after.version).toBe(page.version);
    await unlock(w.bo, id);
    expect((await w.bo.client.patch(`/api/pages/${id}/tasks/${taskId}`, { checked: true })).status).toBe(200);
  });
});

describe('trash respects the lock', () => {
  it('a locked page, or a page with a locked page under it, is not trashed; after unlock both are', async () => {
    const plans = await makePage(w.sam.client, 'Plans');
    const budget = await makePage(w.sam.client, 'Budget', { parentId: plans });
    const other = await makePage(w.sam.client, 'Other', { parentId: plans });
    await lock(w.bo, budget);

    const own = await w.cy.client.del(`/api/pages/${budget}`);
    expect(own.status).toBe(423);
    expect(own.body).toEqual({ error: 'page_locked', message: lockedMessage('Bo') });
    const parent = await w.cy.client.del(`/api/pages/${plans}`);
    expect(parent.status).toBe(423);
    expect(parent.body).toEqual({ error: 'page_locked', message: '“Budget” under this page is locked by Bo. Unlock it first.' });
    for (const id of [plans, budget, other]) expect((await row(id)).deleted_at).toBeNull();
    // A sibling of the locked page is not under it, so it can go.
    expect((await w.cy.client.del(`/api/pages/${other}`)).body.deleted).toBe(1);

    await unlock(w.cy, budget);
    const ok = await w.cy.client.del(`/api/pages/${plans}`);
    expect(ok.status).toBe(200);
    expect(ok.body.deleted).toBe(2);
    expect((await row(budget)).deleted_at).not.toBeNull();
  });

  it('trashing the whole space works with a locked page, and restoring it brings the page back still locked', async () => {
    const id = await makePage(w.sam.client, 'Ledger', { key: 'ops' });
    await lock(w.sam, id);
    const before = await row(id);
    expect((await w.sam.client.del('/api/spaces/ops')).status).toBe(204);
    const space = (await ctx.pool.query(`select id from spaces where key = 'ops'`)).rows[0].id as string;
    expect((await w.sam.client.post(`/api/trash/spaces/${space}/restore`)).status).toBe(200);
    const after = await row(id);
    expect(after.locked_at).toEqual(before.locked_at);
    expect(after.locked_by).toBe(w.sam.user.id);
    expect((await getPage(w.sam.client, id)).lock.by.id).toBe(w.sam.user.id);
    expect((await w.sam.client.put(`/api/pages/${id}`, { baseVersion: after.version, title: 'x' })).status).toBe(423);
  });
});

describe('templates never copy a lock', () => {
  it('"Save as template" from a locked page works; a page made from it starts unlocked', async () => {
    const id = await makePage(w.sam.client, 'Pattern', { doc: doc('shape') });
    await lock(w.bo, id);
    const t = await w.cy.client.post('/api/spaces/eng/templates', { name: 'From locked', fromPageId: id });
    expect(t.status).toBe(201);
    expect(Object.keys(t.body.template).filter((k) => /lock/i.test(k))).toEqual([]);
    // The template table has no lock column at all.
    const cols = await ctx.pool.query(`select column_name from information_schema.columns where table_name = 'page_templates' and column_name like '%lock%'`);
    expect(cols.rows).toEqual([]);
    const made = await w.cy.client.post('/api/spaces/eng/pages', { title: 'Made', parentId: null, templateId: t.body.template.id });
    expect(made.status).toBe(201);
    const page = await getPage(w.cy.client, made.body.page.id);
    expect(page.lock).toBeNull();
    expect(JSON.stringify(page.doc)).toContain('shape');
    expect((await row(made.body.page.id)).locked_at).toBeNull();
  });
});

describe('what a lock does not stop', () => {
  it('comments, labels, follow, favourite, export, search, moving and making a sub-page all work on a locked page', async () => {
    const home = await makePage(w.sam.client, 'Home');
    const id = await makePage(w.sam.client, 'Quarry', { doc: doc('zanzibarite notes') });
    await lock(w.bo, id);
    const c = w.cy.client;
    expect((await c.post(`/api/pages/${id}/comments`, { body: 'Looks right' })).status).toBe(201);
    expect((await c.post(`/api/pages/${id}/labels`, { name: 'finance' })).status).toBe(200);
    expect((await c.put(`/api/pages/${id}/follow`)).status).toBe(200);
    expect((await c.put(`/api/pages/${id}/favourite`)).status).toBe(204);
    const md = await c.get(`/api/pages/${id}/export?format=md`);
    expect(md.status).toBe(200);
    expect(md.raw.body).toContain('zanzibarite');
    const found = await w.vi.client.get('/api/search?q=zanzibarite');
    expect(found.body.results.map((r: any) => r.pageId)).toContain(id);
    expect((await c.post(`/api/pages/${id}/move`, { parentId: home, index: 0 })).status).toBe(200);
    const sub = await c.post('/api/spaces/eng/pages', { title: 'Under', parentId: id });
    expect(sub.status).toBe(201);
    expect((await getPage(c, sub.body.page.id)).lock).toBeNull();
    expect((await c.put(`/api/pages/${sub.body.page.id}`, { baseVersion: 1, title: 'Under, edited' })).status).toBe(200);

    const page = await getPage(c, id);
    expect(page.parentId).toBe(home);
    expect(page.labels.map((l: any) => l.name)).toContain('finance');
    expect(page.following).toBe(true);
    expect(page.favourite).toBe(true);
    expect(page.lock.by.id).toBe(w.bo.user.id);
  });
});
