// Page storage: create, read, save, move, delete. Permission checks happen in
// the routes before these are called. savePage is the ONLY writer of
// pages.doc (ARCHITECTURE.md §3, rule 5), and createPage and savePage are the
// only writers of page_versions (§5), always in the same transaction as the
// page row, so a page and its history never disagree. The same two are the
// only writers of page_tasks (done-check 12): the task index is rebuilt from
// the saved doc in the same transaction (replaceTasks).
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { EMPTY_DOC, type Crumb, type Doc, type Page, type Role } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pageFavourites, pageTasks, pageVersions, pages, spaces, users } from '../db/schema.js';
import { requireSpaceRole } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { badRequest, conflict, notFound } from '../http.js';
import type { DocTask } from '@stillwater/editor-schema';
import { normalizeDoc } from './docText.js';
import { labelsJson } from '../labels/labelSql.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Fractional-index keys compare by code unit, so sort with the C collation. */
export const byPosition = sql`${pages.position} collate "C"`;

/** Serialises tree changes (create/move) within one space. */
export async function lockSpaceTree(tx: Tx, spaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stillwater:tree:' + spaceId}))`);
}

function sameParent(parentId: string | null) {
  return parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId);
}

async function requireLiveParent(tx: Tx, spaceId: string, parentId: string) {
  const [parent] = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.id, parentId), eq(pages.spaceId, spaceId), isNull(pages.deletedAt)));
  if (!parent) throw badRequest('The parent page does not exist in this space');
}

/**
 * Make the page's page_tasks rows match its doc. Called only by createPage and
 * savePage, inside their transaction, right after the page row is written.
 */
async function replaceTasks(tx: Tx, pageId: string, spaceId: string, tasks: DocTask[]) {
  await tx.delete(pageTasks).where(eq(pageTasks.pageId, pageId));
  if (tasks.length === 0) return;
  // The doc is the truth and keeps any well-formed assignee as sent, but the
  // index only names people who exist here (done-check 12a, lead acceptance):
  // an id from another wiki or an import is indexed as nobody's, not a 500.
  const wanted = [...new Set(tasks.flatMap((t) => (t.assignee ? [t.assignee.toLowerCase()] : [])))];
  const known = new Set(
    wanted.length === 0
      ? []
      : (await tx.select({ id: users.id }).from(users).where(inArray(users.id, wanted))).map((u) => u.id.toLowerCase()),
  );
  await tx.insert(pageTasks).values(
    tasks.map((t) => ({
      pageId,
      taskId: t.taskId,
      spaceId,
      assigneeId: t.assignee && known.has(t.assignee.toLowerCase()) ? t.assignee : null,
      due: t.due,
      checked: t.checked,
      text: t.text,
      position: t.position,
    })),
  );
}

export async function createPage(
  db: Db,
  input: { spaceId: string; userId: string; title: string; parentId: string | null; doc?: Doc },
): Promise<string> {
  const { doc, text, tasks } = normalizeDoc(input.doc ?? EMPTY_DOC);
  return db.transaction(async (tx) => {
    await lockSpaceTree(tx, input.spaceId);
    if (input.parentId) await requireLiveParent(tx, input.spaceId, input.parentId);
    const [last] = await tx
      .select({ position: pages.position })
      .from(pages)
      .where(and(eq(pages.spaceId, input.spaceId), sameParent(input.parentId)))
      .orderBy(sql`${byPosition} desc`)
      .limit(1);
    const [row] = await tx
      .insert(pages)
      .values({
        spaceId: input.spaceId,
        parentId: input.parentId,
        position: generateKeyBetween(last?.position ?? null, null),
        title: input.title,
        doc,
        docText: text,
        createdBy: input.userId,
        updatedBy: input.userId,
      })
      .returning({ id: pages.id, version: pages.version, updatedAt: pages.updatedAt });
    await tx.insert(pageVersions).values({
      pageId: row!.id,
      version: row!.version,
      title: input.title,
      doc,
      authorId: input.userId,
      createdAt: row!.updatedAt,
      savedAt: row!.updatedAt,
    });
    await replaceTasks(tx, row!.id, input.spaceId, tasks);
    return row!.id;
  });
}

/** Live (not deleted) page's space, or 404. */
export async function pageSpaceId(db: Db, pageId: string): Promise<string> {
  const [row] = await db
    .select({ spaceId: pages.spaceId })
    .from(pages)
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)));
  if (!row) throw notFound('Page not found');
  return row.spaceId;
}

/** Load a page for a user who may read it; 404 for missing, deleted or not visible. */
export async function requirePageRole(db: Db, user: SessionUser, pageId: string, needed: Role) {
  const spaceId = await pageSpaceId(db, pageId);
  try {
    return await requireSpaceRole(db, user, spaceId, needed);
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw notFound('Page not found');
    throw err;
  }
}

async function breadcrumbs(db: Db, parentId: string | null): Promise<Crumb[]> {
  if (!parentId) return [];
  const res = await db.execute<{ id: string; title: string }>(sql`
    with recursive anc as (
      select id, parent_id, title, 0 as depth from pages where id = ${parentId}
      union all
      select p.id, p.parent_id, p.title, anc.depth + 1 from pages p join anc on p.id = anc.parent_id where anc.depth < 1000
    )
    select id, title from anc order by depth desc`);
  return res.rows.map((r) => ({ id: r.id, title: r.title }));
}

export async function getPageView(db: Db, user: SessionUser, pageId: string): Promise<Page> {
  const { role } = await requirePageRole(db, user, pageId, 'viewer');
  const [row] = await db
    .select({
      page: pages,
      spaceKey: spaces.key,
      updatedByName: users.name,
      favourite: sql<boolean>`exists (select 1 from ${pageFavourites} where ${pageFavourites.userId} = ${user.id} and ${pageFavourites.pageId} = ${pages.id})`,
      labels: labelsJson(pages.id),
    })
    .from(pages)
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .leftJoin(users, eq(users.id, pages.updatedBy))
    .where(eq(pages.id, pageId));
  if (!row) throw notFound('Page not found');
  const p = row.page;
  return {
    id: p.id,
    spaceId: p.spaceId,
    spaceKey: row.spaceKey,
    parentId: p.parentId,
    title: p.title,
    doc: p.doc,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    updatedBy: p.updatedBy && row.updatedByName ? { id: p.updatedBy, name: row.updatedByName } : null,
    breadcrumbs: await breadcrumbs(db, p.parentId),
    myRole: role,
    favourite: row.favourite,
    labels: row.labels,
  };
}

/** Snapshots by the same author opened less than this long ago are folded into. */
export const SNAPSHOT_WINDOW_MINUTES = 5;

/**
 * Record a save in page history (ARCHITECTURE.md §5). Must run in the same
 * transaction as the page update. If the newest snapshot is by the same
 * author, is not a restore, and was opened (created_at) less than
 * SNAPSHOT_WINDOW_MINUTES ago, it is updated in place to the new version;
 * otherwise a new snapshot is inserted. A restore always inserts.
 */
async function recordSnapshot(
  tx: Tx,
  s: { pageId: string; version: number; title: string; doc: Doc; authorId: string; savedAt: Date; restoredFrom: number | null },
) {
  if (s.restoredFrom === null) {
    const folded = await tx.execute(sql`
      update page_versions
      set version = ${s.version}, title = ${s.title}, doc = ${JSON.stringify(s.doc)}::jsonb, saved_at = ${s.savedAt}
      where id = (select id from page_versions where page_id = ${s.pageId} order by version desc limit 1)
        and author_id = ${s.authorId}
        and restored_from is null
        and created_at > now() - make_interval(mins => ${SNAPSHOT_WINDOW_MINUTES})`);
    if ((folded.rowCount ?? 0) > 0) return;
  }
  await tx.insert(pageVersions).values({
    pageId: s.pageId,
    version: s.version,
    title: s.title,
    doc: s.doc,
    authorId: s.authorId,
    savedAt: s.savedAt,
    restoredFrom: s.restoredFrom,
  });
}

/**
 * The single write path for a page's title and body. Optimistic concurrency:
 * the caller sends the version it started from; a stale one is refused with 409.
 * The history snapshot is written in the same transaction (see recordSnapshot);
 * a refused save writes nothing. `restoredFrom` is set only by restore.
 */
export async function savePage(
  db: Db,
  pageId: string,
  change: { title?: string; doc?: Doc },
  baseVersion: number,
  userId: string,
  opts: { restoredFrom?: number } = {},
): Promise<{ version: number }> {
  const body = change.doc !== undefined ? normalizeDoc(change.doc) : undefined;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(pages)
      .set({
        ...(change.title !== undefined ? { title: change.title } : {}),
        ...(body ? { doc: body.doc, docText: body.text } : {}),
        version: sql`${pages.version} + 1`,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(pages.id, pageId), eq(pages.version, baseVersion), isNull(pages.deletedAt)))
      .returning({ version: pages.version, title: pages.title, doc: pages.doc, updatedAt: pages.updatedAt, spaceId: pages.spaceId });
    if (row) {
      if (body) await replaceTasks(tx, pageId, row.spaceId, body.tasks);
      await recordSnapshot(tx, {
        pageId,
        version: row.version,
        title: row.title,
        doc: row.doc,
        authorId: userId,
        savedAt: row.updatedAt,
        restoredFrom: opts.restoredFrom ?? null,
      });
      return { version: row.version };
    }
    const [current] = await tx
      .select({ version: pages.version })
      .from(pages)
      .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)));
    if (!current) throw notFound('Page not found');
    throw conflict('stale_version', `This page was changed by someone else (now version ${current.version}). Reload to get the latest.`);
  });
}

/** Move a page under a new parent (null = top level) at a sibling index. */
export async function movePage(
  db: Db,
  input: { pageId: string; spaceId: string; parentId: string | null; index: number },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSpaceTree(tx, input.spaceId);
    if (input.parentId) {
      if (input.parentId === input.pageId) throw badRequest('A page cannot be moved inside itself');
      await requireLiveParent(tx, input.spaceId, input.parentId);
      const cycle = await tx.execute<{ hit: boolean }>(sql`
        with recursive anc as (
          select id, parent_id, 0 as depth from pages where id = ${input.parentId}
          union all
          select p.id, p.parent_id, anc.depth + 1 from pages p join anc on p.id = anc.parent_id where anc.depth < 1000
        )
        select exists (select 1 from anc where id = ${input.pageId}) as hit`);
      if (cycle.rows[0]?.hit) throw badRequest('A page cannot be moved inside one of its own sub-pages');
    }
    const siblings = await tx
      .select({ id: pages.id, position: pages.position })
      .from(pages)
      .where(
        and(
          eq(pages.spaceId, input.spaceId),
          sameParent(input.parentId),
          isNull(pages.deletedAt),
          sql`${pages.id} <> ${input.pageId}`,
        ),
      )
      .orderBy(byPosition, asc(pages.id));
    const index = Math.min(input.index, siblings.length);
    let keys = siblings.map((s) => s.position);
    if (keys.some((k, i) => i > 0 && keys[i - 1]! >= k)) {
      // Duplicate keys (should not happen under the lock): renumber the siblings first.
      keys = [];
      for (const s of siblings) {
        const key = generateKeyBetween(keys.at(-1) ?? null, null);
        await tx.update(pages).set({ position: key }).where(eq(pages.id, s.id));
        keys.push(key);
      }
    }
    const position = generateKeyBetween(keys[index - 1] ?? null, keys[index] ?? null);
    await tx.update(pages).set({ parentId: input.parentId, position }).where(eq(pages.id, input.pageId));
  });
}

/**
 * Move a page and every live page under it to the trash (done-check 11), in
 * one statement: they all get the same deleted_at, deleted_by and
 * trash_root_id (this page's id), so the delete is one trash item. Sub-pages
 * already in the trash on their own are left as their own items. Touches no
 * document, version or history column.
 */
export async function deletePage(db: Db, pageId: string, userId: string): Promise<number> {
  const res = await db.execute(sql`
    with recursive sub as (
      select id from pages where id = ${pageId} and deleted_at is null
      union all
      select p.id from pages p join sub on p.parent_id = sub.id where p.deleted_at is null
    )
    update pages set deleted_at = now(), deleted_by = ${userId}, trash_root_id = ${pageId}
    where id in (select id from sub)`);
  return res.rowCount ?? 0;
}
