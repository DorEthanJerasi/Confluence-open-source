// Tasks, server side (docs/done-checks/12-tasks.md, "12a — Server"): task ids
// and attrs, the page_tasks index rebuilt by createPage/savePage, My tasks,
// the tick route through savePage, the people list, and who may do what.
// Real Postgres.
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
 * editors, Vi a viewer), the restricted space "sec" (Cy only) and the open
 * space "pub". Nm is signed in and in no restricted space. Di is disabled.
 */
async function world() {
  const ada = await signup(ctx.app, 'Ada');
  const sam = await signup(ctx.app, 'Sam');
  const bo = await signup(ctx.app, 'Bo');
  const cy = await signup(ctx.app, 'Cy');
  const vi = await signup(ctx.app, 'Vi');
  const nm = await signup(ctx.app, 'Nm');
  const di = await signup(ctx.app, 'Di');
  for (const [key, name, visibility] of [
    ['eng', 'Engineering', 'restricted'],
    ['sec', 'Secret', 'restricted'],
    ['pub', 'Public', 'open'],
  ] as const) {
    expect((await sam.client.post('/api/spaces', { key, name, visibility })).status).toBe(201);
  }
  await sam.client.put(`/api/spaces/eng/members/${bo.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${cy.user.id}`, { role: 'editor' });
  await sam.client.put(`/api/spaces/eng/members/${vi.user.id}`, { role: 'viewer' });
  await sam.client.put(`/api/spaces/sec/members/${cy.user.id}`, { role: 'editor' });
  // Di is a member of eng, then disabled: left out of every people list.
  await sam.client.put(`/api/spaces/eng/members/${di.user.id}`, { role: 'editor' });
  expect((await ada.client.patch(`/api/users/${di.user.id}`, { disabled: true })).status).toBe(200);
  return { ada, sam, bo, cy, vi, nm, di };
}

const p = (text: string) => ({ type: 'paragraph', attrs: { id: `b-${text}` }, content: [{ type: 'text', text }] });
type T = { text: string; taskId?: string; assignee?: string | null; due?: string | null; checked?: boolean; sub?: T[] };
const item = (t: T): unknown => ({
  type: 'taskItem',
  attrs: { checked: t.checked ?? false, taskId: t.taskId ?? null, assignee: t.assignee ?? null, due: t.due ?? null },
  content: t.sub ? [p(t.text), { type: 'taskList', content: t.sub.map(item) }] : [p(t.text)],
});
const taskDoc = (...tasks: T[]) => ({
  type: 'doc',
  content: [p('intro'), { type: 'taskList', attrs: { id: 'list-1' }, content: tasks.map(item) }],
});

async function makePage(c: Client, title: string, doc?: unknown, key = 'eng', parentId: string | null = null) {
  const res = await c.post(`/api/spaces/${key}/pages`, { title, parentId });
  expect(res.status).toBe(201);
  const id = res.body.page.id as string;
  if (doc) expect((await c.put(`/api/pages/${id}`, { baseVersion: 1, doc })).status).toBe(200);
  return id;
}

const getPage = async (c: Client, id: string) => (await c.get(`/api/pages/${id}`)).body.page;

/** Every task of a doc JSON in order. */
function tasksOf(doc: any): { taskId: string; checked: boolean; assignee: string | null; text: string }[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (n?.type === 'taskItem') out.push({ ...n.attrs, text: n.content[0]?.content?.[0]?.text ?? '' });
    (n?.content ?? []).forEach(walk);
  };
  walk(doc);
  return out;
}

const myTasks = async (who: Person) => {
  const res = await who.client.get('/api/me/tasks');
  expect(res.status).toBe(200);
  return res.body.tasks as {
    pageId: string;
    taskId: string;
    text: string;
    due: string | null;
    page: { id: string; title: string };
    space: { key: string; name: string };
    canTick: boolean;
  }[];
};
const myTexts = async (who: Person) => (await myTasks(who)).map((t) => t.text);
const tick = (who: Person, pageId: string, taskId: string, checked: boolean) =>
  who.client.patch(`/api/pages/${pageId}/tasks/${taskId}`, { checked });
const taskRows = async (pageId: string) =>
  (await ctx.pool.query('select task_id, assignee_id, checked from page_tasks where page_id = $1 order by position', [pageId])).rows;
const sessionUser = (who: Person, name: string): SessionUser => ({
  id: who.user.id,
  email: `${name.toLowerCase()}@example.com`,
  name,
  role: who.user.role as SessionUser['role'],
});

describe('My tasks', () => {
  it('lists the open tasks given to a person, dated first, with page and space', async () => {
    const { cy, bo } = w;
    const id = await makePage(
      cy.client,
      'Launch plan',
      taskDoc(
        { text: 'Undated for Bo', assignee: bo.user.id },
        { text: 'Dated for Bo', assignee: bo.user.id, due: '2026-12-01' },
        { text: 'For nobody' },
      ),
    );
    const mine = (await myTasks(bo)).filter((t) => t.pageId === id);
    expect(mine.map((t) => t.text)).toEqual(['Dated for Bo', 'Undated for Bo']);
    expect(mine[0]).toMatchObject({
      due: '2026-12-01',
      page: { id, title: 'Launch plan' },
      space: { key: 'eng', name: 'Engineering' },
      canTick: true,
    });
    expect(mine[1]!.due).toBeNull();
    expect(mine[0]!.taskId).toMatch(/^[0-9a-f-]{36}$/);
    for (const who of [w.ada, w.sam, w.bo, w.cy, w.vi, w.nm]) expect(await myTexts(who)).not.toContain('For nobody');
    expect(await taskRows(id)).toHaveLength(3);
  });

  it('orders by due date, then page title, then place in the page', async () => {
    const { cy, bo } = w;
    const b = await makePage(cy.client, 'Order B', taskDoc({ text: 'ob-1', assignee: bo.user.id, due: '2026-12-05' }, { text: 'ob-2', assignee: bo.user.id }));
    const a = await makePage(
      cy.client,
      'Order A',
      taskDoc({ text: 'oa-2', assignee: bo.user.id }, { text: 'oa-1', assignee: bo.user.id, due: '2026-12-05' }, { text: 'oa-3', assignee: bo.user.id }),
    );
    const order = (await myTasks(bo)).filter((t) => t.pageId === a || t.pageId === b).map((t) => t.text);
    expect(order).toEqual(['oa-1', 'ob-1', 'oa-2', 'oa-3', 'ob-2']);
  });
});

describe('task ids and attrs', () => {
  it('fills missing ids (nested too), renews a repeated one and keeps them on the next save', async () => {
    const { cy } = w;
    const id = await makePage(cy.client, 'Ids', taskDoc({ text: 'a', sub: [{ text: 'a.1' }] }, { text: 'b' }));
    const first = tasksOf((await getPage(cy.client, id)).doc).map((t) => t.taskId);
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect((await taskRows(id)).map((r) => r.task_id)).toEqual(first);

    const page = await getPage(cy.client, id);
    expect((await cy.client.put(`/api/pages/${id}`, { baseVersion: page.version, doc: page.doc })).status).toBe(200);
    expect(tasksOf((await getPage(cy.client, id)).doc).map((t) => t.taskId)).toEqual(first);

    const dup = await makePage(cy.client, 'Dup', taskDoc({ text: 'x', taskId: 'same' }, { text: 'y', taskId: 'same' }));
    const ids = tasksOf((await getPage(cy.client, dup)).doc).map((t) => t.taskId);
    expect(ids[0]).toBe('same');
    expect(ids[1]).not.toBe('same');
  });

  it('refuses a bad due date or person with 400 and saves nothing', async () => {
    const { cy } = w;
    const id = await makePage(cy.client, 'Bad attrs', taskDoc({ text: 'ok' }));
    const before = await getPage(cy.client, id);
    for (const bad of [{ due: '2026-02-30' }, { due: 'tomorrow' }, { assignee: 'bob' }]) {
      const res = await cy.client.put(`/api/pages/${id}`, { baseVersion: before.version, doc: taskDoc({ text: 'bad', ...bad }) });
      expect(res.status).toBe(400);
    }
    const res = await cy.client.post('/api/spaces/eng/pages', { title: 'Bad new', parentId: null, doc: taskDoc({ text: 'x', due: 'tomorrow' }) });
    expect(res.status).toBe(400);
    const after = await getPage(cy.client, id);
    expect(after.version).toBe(before.version);
    expect(tasksOf(after.doc).map((t) => t.text)).toEqual(['ok']);
  });

  it('a well-formed id that is no person here saves (200), stays in the doc as sent, is indexed as nobody and in no My tasks', async () => {
    const { cy, bo, sam } = w;
    const stranger = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const shouty = '0F0E0D0C-0B0A-4908-8706-0504030201FF';
    const id = await makePage(cy.client, 'Strangers', taskDoc({ text: 'u-ok' }));
    const before = await getPage(cy.client, id);
    const doc = taskDoc(
      { text: 'u-stranger', assignee: stranger, due: '2026-12-01' },
      { text: 'u-shouty', assignee: shouty },
      { text: 'u-bo', assignee: bo.user.id.toUpperCase() },
    );
    const res = await cy.client.put(`/api/pages/${id}`, { baseVersion: before.version, doc });
    expect(res.status).toBe(200);

    const saved = await getPage(cy.client, id);
    expect(saved.version).toBe(before.version + 1);
    expect(tasksOf(saved.doc).map((t) => [t.text, t.assignee])).toEqual([
      ['u-stranger', stranger],
      ['u-shouty', shouty],
      ['u-bo', bo.user.id.toUpperCase()],
    ]);
    const rows = await taskRows(id);
    expect(rows.map((r) => r.assignee_id)).toEqual([null, null, bo.user.id]);
    for (const who of [w.ada, sam, bo, cy, w.vi, w.nm]) {
      const texts = await myTexts(who);
      expect(texts).not.toContain('u-stranger');
      expect(texts).not.toContain('u-shouty');
    }
    expect(await myTexts(bo)).toContain('u-bo');

    // Restoring a version that holds such a task works the same way (Sam's save
    // makes a new snapshot, so the stranger version can be restored).
    const cleared = await sam.client.put(`/api/pages/${id}`, { baseVersion: saved.version, doc: taskDoc({ text: 'u-ok' }) });
    expect(cleared.status).toBe(200);
    const now = await getPage(cy.client, id);
    const restored = await cy.client.post(`/api/pages/${id}/versions/${saved.version}/restore`, { baseVersion: now.version });
    expect(restored.status).toBe(200);
    expect(tasksOf((await getPage(cy.client, id)).doc).map((t) => t.assignee)).toEqual([stranger, shouty, bo.user.id.toUpperCase()]);
    expect((await taskRows(id)).map((r) => r.assignee_id)).toEqual([null, null, bo.user.id]);
  });
});

describe('ticking from My tasks', () => {
  it('ticks through savePage: one new version by the person, nothing else in the doc changes', async () => {
    const { cy, bo } = w;
    const id = await makePage(
      cy.client,
      'Tick me',
      taskDoc({ text: 'Mine', assignee: bo.user.id, sub: [{ text: 'Nested' }] }, { text: 'Other', assignee: cy.user.id }),
    );
    const before = await getPage(cy.client, id);
    const task = (await myTasks(bo)).find((t) => t.pageId === id)!;

    const res = await tick(bo, id, task.taskId, true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: before.version + 1, checked: true });
    expect(await myTexts(bo)).not.toContain('Mine');

    const after = await getPage(cy.client, id);
    expect(after.version).toBe(before.version + 1);
    expect(after.id).toBe(before.id);
    const expected = structuredClone(before.doc);
    (expected.content[1].content[0].attrs as { checked: boolean }).checked = true;
    expect(after.doc).toEqual(expected);

    const history = (await cy.client.get(`/api/pages/${id}/versions`)).body;
    expect(history.versions[0]).toMatchObject({ version: after.version, author: { id: bo.user.id } });

    // Twice: 200, no new version.
    const again = await tick(bo, id, task.taskId, true);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ version: after.version, checked: true });
    expect((await getPage(cy.client, id)).version).toBe(after.version);

    // Untick brings it back.
    const un = await tick(bo, id, task.taskId, false);
    expect(un.body).toEqual({ version: after.version + 1, checked: false });
    expect(await myTexts(bo)).toContain('Mine');
    expect((await getPage(cy.client, id)).doc).toEqual(before.doc);
  });

  it('retries once when the page changed between the read and the save; a second conflict is 409', async () => {
    const { cy, bo } = w;
    const id = await makePage(cy.client, 'Busy page', taskDoc({ text: 'Busy task', assignee: bo.user.id }));
    const task = (await myTasks(bo)).find((t) => t.pageId === id)!;
    const otherSave = async () => {
      const page = await getPage(cy.client, id);
      await savePage(ctx.db, id, { title: `${page.title}!` }, page.version, cy.user.id);
    };

    let calls = 0;
    const once = await tickTask(ctx.db, sessionUser(bo, 'Bo'), id, task.taskId, true, {
      beforeSave: async () => {
        if (calls++ === 0) await otherSave();
      },
    });
    expect(calls).toBe(2);
    expect(once.checked).toBe(true);
    const page = await getPage(cy.client, id);
    expect(page.title).toBe('Busy page!');
    expect(tasksOf(page.doc)[0]!.checked).toBe(true);
    expect(once.version).toBe(page.version);

    await expect(
      tickTask(ctx.db, sessionUser(bo, 'Bo'), id, task.taskId, false, { beforeSave: otherSave }),
    ).rejects.toMatchObject({ status: 409, message: 'The page just changed, try again' });
    expect(tasksOf((await getPage(cy.client, id)).doc)[0]!.checked).toBe(true);
  });

  it('a task id that is not on the page is 404', async () => {
    const { cy, bo } = w;
    const id = await makePage(cy.client, 'No such task', taskDoc({ text: 't', assignee: bo.user.id }));
    expect((await tick(bo, id, 'nope', true)).status).toBe(404);
    expect((await tick(bo, id, 'bad%20id', true)).status).toBe(404);
    expect((await bo.client.patch(`/api/pages/${id}/tasks/x`, { checked: 'yes' })).status).toBe(400);
  });
});

describe('editing the page keeps My tasks right', () => {
  it('removing, reassigning or ticking in the doc shows at the next read; restoring history brings old tasks back', async () => {
    const { cy, bo, sam } = w;
    const id = await makePage(
      cy.client,
      'Edits',
      taskDoc({ text: 'e-keep', assignee: bo.user.id }, { text: 'e-move', assignee: bo.user.id }, { text: 'e-tick', assignee: bo.user.id }),
    );
    const v1 = await getPage(cy.client, id);
    expect(await myTexts(bo)).toEqual(expect.arrayContaining(['e-keep', 'e-move', 'e-tick']));

    // Sam (another author) edits, so this is a new history snapshot.
    const [keep, move, done] = v1.doc.content[1].content;
    move.attrs.assignee = cy.user.id;
    done.attrs.checked = true;
    const edited = { ...v1.doc, content: [v1.doc.content[0], { ...v1.doc.content[1], content: [move, done] }] };
    expect((await sam.client.put(`/api/pages/${id}`, { baseVersion: v1.version, doc: edited })).status).toBe(200);
    expect(keep.attrs.taskId).toBeTruthy();

    const boNow = await myTexts(bo);
    expect(boNow).not.toContain('e-keep');
    expect(boNow).not.toContain('e-move');
    expect(boNow).not.toContain('e-tick');
    expect(await myTexts(cy)).toContain('e-move');

    const versions = (await cy.client.get(`/api/pages/${id}/versions`)).body.versions as { version: number }[];
    const oldest = versions.at(-1)!.version;
    const now = await getPage(cy.client, id);
    const restored = await cy.client.post(`/api/pages/${id}/versions/${oldest}/restore`, { baseVersion: now.version });
    expect(restored.status).toBe(200);
    // The oldest snapshot is Cy's first save of the page (version 2, tasks for Bo).
    expect(await myTexts(bo)).toEqual(expect.arrayContaining(['e-keep', 'e-move', 'e-tick']));
    expect(await myTexts(cy)).not.toContain('e-move');
  });
});

describe('trash', () => {
  it('a trashed page or parent hides its tasks and the tick is 404; restore brings them back; purge removes the rows', async () => {
    const { cy, bo } = w;
    const parent = await makePage(cy.client, 'Trash parent');
    const id = await makePage(cy.client, 'Trash child', undefined, 'eng', parent);
    const page = await getPage(cy.client, id);
    expect((await cy.client.put(`/api/pages/${id}`, { baseVersion: page.version, doc: taskDoc({ text: 't-task', assignee: bo.user.id }) })).status).toBe(200);
    const task = (await myTasks(bo)).find((t) => t.pageId === id)!;

    expect((await cy.client.del(`/api/pages/${parent}`)).status).toBe(200);
    expect(await myTexts(bo)).not.toContain('t-task');
    expect((await tick(bo, id, task.taskId, true)).status).toBe(404);
    expect(await taskRows(id)).toHaveLength(1);

    expect((await cy.client.post(`/api/pages/${parent}/restore`)).status).toBe(200);
    expect(await myTexts(bo)).toContain('t-task');

    expect((await cy.client.del(`/api/pages/${id}`)).status).toBe(200);
    expect(await myTexts(bo)).not.toContain('t-task');
    expect((await w.sam.client.del(`/api/pages/${id}/purge`)).status).toBe(204);
    expect(await taskRows(id)).toHaveLength(0);
  });

  it('a trashed space hides its tasks until it is restored', async () => {
    const { sam, bo } = w;
    expect((await sam.client.post('/api/spaces', { key: 'tmp', name: 'Temporary', visibility: 'restricted' })).status).toBe(201);
    await sam.client.put(`/api/spaces/tmp/members/${bo.user.id}`, { role: 'editor' });
    const id = await makePage(sam.client, 'In tmp', taskDoc({ text: 'tmp-task', assignee: bo.user.id }), 'tmp');
    const task = (await myTasks(bo)).find((t) => t.pageId === id)!;
    const spaceId = (await getPage(sam.client, id)).spaceId as string;

    expect((await sam.client.del('/api/spaces/tmp')).status).toBe(204);
    expect(await myTexts(bo)).not.toContain('tmp-task');
    expect((await tick(bo, id, task.taskId, true)).status).toBe(404);

    expect((await sam.client.post(`/api/trash/spaces/${spaceId}/restore`)).status).toBe(200);
    expect(await myTexts(bo)).toContain('tmp-task');
  });
});

describe('access', () => {
  it('hides tasks in spaces the person cannot read, now', async () => {
    const { cy, bo, sam } = w;
    const id = await makePage(cy.client, 'Secret page', taskDoc({ text: 'sec-task', assignee: bo.user.id }), 'sec');
    expect(await myTexts(bo)).not.toContain('sec-task');
    expect(await taskRows(id)).toHaveLength(1);

    expect((await sam.client.put(`/api/spaces/sec/members/${bo.user.id}`, { role: 'editor' })).status).toBe(200);
    expect(await myTexts(bo)).toContain('sec-task');
    expect((await sam.client.del(`/api/spaces/sec/members/${bo.user.id}`)).status).toBe(200);
    expect(await myTexts(bo)).not.toContain('sec-task');
  });

  it('a viewer sees their task with canTick false and gets 403; a non-member gets 404', async () => {
    const { cy, vi, nm } = w;
    const id = await makePage(cy.client, 'For the viewer', taskDoc({ text: 'vi-task', assignee: vi.user.id }));
    const task = (await myTasks(vi)).find((t) => t.pageId === id)!;
    expect(task).toMatchObject({ text: 'vi-task', canTick: false });
    expect((await tick(vi, id, task.taskId, true)).status).toBe(403);
    expect((await tick(nm, id, task.taskId, true)).status).toBe(404);
    expect((await nm.client.get('/api/spaces/eng/people')).status).toBe(404);
    expect(tasksOf((await getPage(cy.client, id)).doc)[0]!.checked).toBe(false);
  });
});

describe('people', () => {
  const names = async (who: Person, key: string, q?: string) => {
    const res = await who.client.get(`/api/spaces/${key}/people${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    expect(res.status).toBe(200);
    return (res.body.people as { id: string; name: string }[]).map((p) => p.name);
  };

  it('a restricted space lists its members and instance admins; an open one every active person; disabled people never', async () => {
    const { vi } = w;
    expect(await names(vi, 'eng')).toEqual(['Ada', 'Bo', 'Cy', 'Sam', 'Vi']);
    expect(await names(w.nm, 'pub')).toEqual(['Ada', 'Bo', 'Cy', 'Nm', 'Sam', 'Vi']);
    const res = await vi.client.get('/api/spaces/eng/people');
    expect(res.body.people[0]).toEqual({ id: w.ada.user.id, name: 'Ada' });
  });

  it('?q= filters by name or email', async () => {
    expect(await names(w.vi, 'eng', 'cy')).toEqual(['Cy']);
    expect(await names(w.vi, 'eng', 'SAM@EXAMPLE')).toEqual(['Sam']);
    expect(await names(w.vi, 'eng', '%')).toEqual([]);
  });
});

describe('templates', () => {
  it('a page made from a built-in template with a task list gets task ids and index rows', async () => {
    const res = await w.cy.client.post('/api/spaces/eng/pages', { title: 'Weekly sync', parentId: null, templateId: 'builtin:meeting-notes' });
    expect(res.status).toBe(201);
    const id = res.body.page.id as string;
    const ids = tasksOf((await getPage(w.cy.client, id)).doc).map((t) => t.taskId);
    expect(ids.length).toBeGreaterThan(0);
    ids.forEach((t) => expect(t).toMatch(/^[0-9a-f-]{36}$/));
    expect((await taskRows(id)).map((r) => r.task_id)).toEqual(ids);
  });
});

describe('signed out', () => {
  it('is 401 on every route', async () => {
    const anon = new Client(ctx.app);
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await anon.get('/api/me/tasks')).status).toBe(401);
    expect((await anon.patch(`/api/pages/${id}/tasks/t1`, { checked: true })).status).toBe(401);
    expect((await anon.get('/api/spaces/eng/people')).status).toBe(401);
  });
});
