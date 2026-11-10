// Tasks (docs/done-checks/12-tasks.md, 12a): My tasks, ticking a task from
// there, and the people a task can be given to. The page document is the
// truth; page_tasks is an index that only createPage and savePage write. A tick
// edits the doc and saves it through savePage, so it is a normal page version.
// Access goes through the one permission path (requirePageRole,
// requireSpaceByKey, visibleSpaceIds, effectiveRole); lists are filtered when
// read, so losing access or trashing a page hides a task at once.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  MY_TASKS_LIMIT,
  SPACE_PEOPLE_LIMIT,
  roleAtLeast,
  type Doc,
  type MyTask,
  type SpacePerson,
  type TickTaskReply,
} from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pageTasks, pages, spaceMembers, spaces, users } from '../db/schema.js';
import { effectiveRole, requireSpaceByKey, visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole, savePage } from '../pages/pages.js';
import { HttpError, conflict, notFound } from '../http.js';

/**
 * The person's open tasks: not ticked, given to them, on a live page in a
 * space they can read now. Dated first (earliest first), then undated; then
 * page title; then order in the page.
 */
export async function myOpenTasks(db: Db, user: SessionUser): Promise<MyTask[]> {
  const rows = await db
    .select({
      pageId: pageTasks.pageId,
      taskId: pageTasks.taskId,
      text: pageTasks.text,
      due: pageTasks.due,
      title: pages.title,
      space: spaces,
      memberRole: spaceMembers.role,
    })
    .from(pageTasks)
    .innerJoin(pages, eq(pages.id, pageTasks.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, user.id)))
    .where(
      and(
        eq(pageTasks.assigneeId, user.id),
        eq(pageTasks.checked, false),
        isNull(pages.deletedAt),
        sql`${pages.spaceId} in (${visibleSpaceIds(user)})`,
      ),
    )
    .orderBy(sql`${pageTasks.due} asc nulls last`, asc(pages.title), asc(pages.id), asc(pageTasks.position))
    .limit(MY_TASKS_LIMIT);
  return rows.map((r) => ({
    pageId: r.pageId,
    taskId: r.taskId,
    text: r.text,
    due: r.due,
    page: { id: r.pageId, title: r.title },
    space: { key: r.space.key, name: r.space.name },
    canTick: roleAtLeast(effectiveRole(user, r.space, r.memberRole ?? null), 'editor'),
  }));
}

type Json = { type?: unknown; attrs?: Record<string, unknown>; content?: unknown };

/** The taskItem with this id in a doc's JSON, or null. */
function findTask(node: Json, taskId: string): Json | null {
  if (node.type === 'taskItem' && node.attrs?.taskId === taskId) return node;
  if (!Array.isArray(node.content)) return null;
  for (const child of node.content) {
    if (child && typeof child === 'object') {
      const hit = findTask(child as Json, taskId);
      if (hit) return hit;
    }
  }
  return null;
}

export interface TickHooks {
  /** Tests only: runs after the page is read and before it is saved. */
  beforeSave?: () => Promise<void>;
}

/**
 * Tick or untick one task (editor and up). Reads the page, flips `checked` on
 * that task and saves through savePage with the version read as the base, so
 * it is a normal new version by this person and nothing else in the doc
 * changes. A save that lands in between (409) is retried once; a second one is
 * a 409 for the screen. Already in the asked state: no new version.
 */
export async function tickTask(
  db: Db,
  user: SessionUser,
  pageId: string,
  taskId: string,
  checked: boolean,
  hooks: TickHooks = {},
): Promise<TickTaskReply> {
  await requirePageRole(db, user, pageId, 'editor');
  for (let attempt = 0; ; attempt++) {
    const [row] = await db
      .select({ doc: pages.doc, version: pages.version })
      .from(pages)
      .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)));
    if (!row) throw notFound('Page not found');
    const doc = structuredClone(row.doc) as Doc;
    const task = findTask(doc as Json, taskId);
    if (!task) throw notFound('Task not found');
    if ((task.attrs?.checked === true) === checked) return { version: row.version, checked };
    task.attrs = { ...task.attrs, checked };
    await hooks.beforeSave?.();
    try {
      const { version } = await savePage(db, pageId, { doc }, row.version, user.id);
      return { version, checked };
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        if (attempt === 0) continue;
        throw conflict('stale_version', 'The page just changed, try again');
      }
      throw err;
    }
  }
}

/** Escape LIKE wildcards so `?q=` is matched as plain text. */
const likeText = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Active people who can read the space (viewer and up asking): in an open
 * space everyone, in a restricted one its members plus instance admins, the
 * same people effectiveRole lets in. Sorted by name; `q` filters by name or email.
 */
export async function spacePeople(db: Db, user: SessionUser, key: string, q?: string): Promise<SpacePerson[]> {
  const { space } = await requireSpaceByKey(db, user, key, 'viewer');
  const canRead =
    space.visibility === 'open'
      ? sql`true`
      : sql`(${users.role} = 'admin' or exists (select 1 from ${spaceMembers} where ${spaceMembers.spaceId} = ${space.id} and ${spaceMembers.userId} = ${users.id}))`;
  const filter = q ? sql`(${users.name} ilike ${likeText(q)} or ${users.email} ilike ${likeText(q)})` : sql`true`;
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(isNull(users.disabledAt), canRead, filter))
    .orderBy(asc(users.name), asc(users.id))
    .limit(SPACE_PEOPLE_LIMIT);
}
