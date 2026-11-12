// Trash (docs/done-checks/11-trash.md). All trash logic lives here.
//
// Trash is a state of the same rows, never a copy: a trashed page or space
// keeps its row and id, and its sub-pages, history, comments, attachments,
// favourites and views are not touched until it is purged. One delete is one
// trash item: the page deleted (the root) and every live page under it share
// deleted_at, deleted_by and trash_root_id. Restore and purge work on a whole
// item. Nothing here writes pages.doc, pages.version, pages.ydoc_state or
// page_versions, so a restored page is the same document with the same id and
// co-editing can still be added later.
//
// Access goes through the one permission path (auth/permissions.ts): live
// spaces through requireSpaceRole / requireSpaceByKey, trashed spaces through
// requireTrashedSpace; both take the role from effectiveRole.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db/client.js';
import { attachments, pages, spaceMembers, spaces, users } from '../db/schema.js';
import { effectiveRole, requireSpaceByKey, requireSpaceRole, requireTrashedSpace } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { badRequest, notFound } from '../http.js';
import { byPosition, deletePage, lockSpaceTree, requirePageRole, type Tx } from '../pages/pages.js';
import { pageLocked, subPageLocked } from '../pages/locks.js';
import type { FileStorage } from '../files/storage.js';
import { env } from '../env.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Person {
  id: string;
  name: string;
}

export interface TrashItem {
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: Person | null;
  /** How many other pages are in this item. */
  subPages: number;
  purgeAt: string | null;
}

export interface TrashedSpace {
  id: string;
  key: string;
  name: string;
  deletedAt: string;
  deletedBy: Person | null;
  purgeAt: string | null;
}

/** When an item trashed at `deletedAt` is purged; null when retention is 0 (never). */
export function purgeAt(deletedAt: Date, retentionDays: number): string | null {
  return retentionDays > 0 ? new Date(deletedAt.getTime() + retentionDays * DAY_MS).toISOString() : null;
}

const person = (id: string | null, name: string | null): Person | null => (id && name ? { id, name } : null);

// ---- Pages ----

/**
 * Move a live page and its live sub-pages to the trash (editor and up).
 * Refused with 423 when the page, or any live page under it, is locked
 * (done-check 17); then nothing is trashed. The branch's rows are read FOR
 * UPDATE in the same transaction as the trash, so a lock taken in between
 * either is seen here or waits and then finds the page gone.
 */
export async function trashPage(db: Db, user: SessionUser, pageId: string): Promise<number> {
  const { space } = await requirePageRole(db, user, pageId, 'editor');
  return db.transaction(async (tx) => {
    await lockSpaceTree(tx, space.id);
    const branch = await tx.execute<{ id: string; title: string; locked_at: Date | null; locked_by_name: string | null }>(sql`
      with recursive sub as (
        select id, 0 as depth from pages where id = ${pageId} and deleted_at is null
        union all
        select p.id, sub.depth + 1 from pages p join sub on p.parent_id = sub.id where p.deleted_at is null and sub.depth < 1000
      )
      select pg.id, pg.title, pg.locked_at, u.name as locked_by_name
      from pages pg join sub on sub.id = pg.id left join users u on u.id = pg.locked_by
      order by sub.depth, pg.position collate "C", pg.id
      for update of pg`);
    if (branch.rows.length === 0) throw notFound('Page not found');
    const locked = branch.rows.find((r) => r.locked_at !== null);
    if (locked) throw locked.id === pageId ? pageLocked(locked.locked_by_name) : subPageLocked(locked.title, locked.locked_by_name);
    return deletePage(tx, pageId, user.id);
  });
}

/**
 * Trash-aware page lookup: finds the page whether or not it is in the trash,
 * then takes the role in its (live) space from the one permission path.
 * Missing page, trashed space or no read access: 404.
 */
async function requireAnyPage(db: Db, user: SessionUser, pageId: string, needed: 'editor' | 'admin') {
  const [page] = await db
    .select({
      id: pages.id,
      spaceId: pages.spaceId,
      parentId: pages.parentId,
      position: pages.position,
      title: pages.title,
      deletedAt: pages.deletedAt,
      trashRootId: pages.trashRootId,
    })
    .from(pages)
    .where(eq(pages.id, pageId));
  if (!page) throw notFound('Page not found');
  try {
    await requireSpaceRole(db, user, page.spaceId, needed);
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw notFound('Page not found');
    throw err;
  }
  return page;
}

/**
 * For a page that gives 404: true when it is in the trash (as a root or with
 * the page above it) and the person may see the space's Trash view (editor and
 * up). Viewers, non-members and missing pages get false, so they learn nothing.
 */
export async function isTrashedForEditor(db: Db, user: SessionUser, pageId: string): Promise<boolean> {
  try {
    const page = await requireAnyPage(db, user, pageId, 'editor');
    // deletePage marks every page under the root, so deleted_at is enough.
    return page.deletedAt !== null;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 403) return false;
    throw err;
  }
}

function requireTrashRoot(page: { id: string; deletedAt: Date | null; trashRootId: string | null }, live: string) {
  if (!page.deletedAt) throw badRequest(live);
  if (page.trashRootId !== page.id) {
    throw badRequest('This page was deleted together with a page above it. Restore or delete that page instead.');
  }
}

/** The Trash view of a space (editor and up): one entry per trash item, newest first. */
export async function listTrash(db: Db, user: SessionUser, key: string, retentionDays: number) {
  const { space } = await requireSpaceByKey(db, user, key, 'editor');
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      deletedAt: pages.deletedAt,
      deletedById: pages.deletedBy,
      deletedByName: users.name,
      subPages: sql<number>`(select count(*)::int from ${pages} s where s.space_id = ${space.id} and s.trash_root_id = ${pages.id} and s.deleted_at is not null and s.id <> ${pages.id})`,
    })
    .from(pages)
    .leftJoin(users, eq(users.id, pages.deletedBy))
    .where(and(eq(pages.spaceId, space.id), isNotNull(pages.deletedAt), eq(pages.trashRootId, pages.id)))
    .orderBy(desc(pages.deletedAt), desc(pages.id));
  const items: TrashItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    deletedAt: r.deletedAt!.toISOString(),
    deletedBy: person(r.deletedById, r.deletedByName),
    subPages: r.subPages,
    purgeAt: purgeAt(r.deletedAt!, retentionDays),
  }));
  return { retentionDays, items };
}

/**
 * Bring a whole trash item back (editor and up). The root goes back under its
 * old parent if that parent is live, otherwise to the top level of the space,
 * so a live page never sits under a trashed one. It keeps its position key
 * unless a live sibling already has it; then it goes at the end.
 */
export async function restorePage(db: Db, user: SessionUser, pageId: string) {
  const page = await requireAnyPage(db, user, pageId, 'editor');
  requireTrashRoot(page, 'This page is not in the trash');
  return db.transaction(async (tx) => {
    await lockSpaceTree(tx, page.spaceId);
    let parentId = page.parentId;
    if (parentId) {
      const [parent] = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.id, parentId), eq(pages.spaceId, page.spaceId), isNull(pages.deletedAt)));
      if (!parent) parentId = null;
    }
    const siblings = await tx
      .select({ position: pages.position })
      .from(pages)
      .where(
        and(
          eq(pages.spaceId, page.spaceId),
          parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId),
          isNull(pages.deletedAt),
        ),
      )
      .orderBy(sql`${byPosition} desc`);
    const position = siblings.some((s) => s.position === page.position)
      ? generateKeyBetween(siblings[0]!.position, null)
      : page.position;
    const back = await tx
      .update(pages)
      .set({ deletedAt: null, deletedBy: null, trashRootId: null })
      .where(and(eq(pages.trashRootId, page.id), isNotNull(pages.deletedAt)))
      .returning({ id: pages.id });
    if (back.length === 0) throw badRequest('This page is not in the trash');
    await tx.update(pages).set({ parentId, position }).where(eq(pages.id, page.id));
    return { page: { id: page.id, parentId, title: page.title } };
  });
}

/** Storage keys of every file on `pageId` and on every page under it. */
async function fileKeysUnder(tx: Tx, pageIds: string[]): Promise<string[]> {
  if (pageIds.length === 0) return [];
  const res = await tx.execute<{ storage_key: string }>(sql`
    with recursive sub as (
      select id, 0 as depth from pages where id in (${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)})
      union all
      select p.id, sub.depth + 1 from pages p join sub on p.parent_id = sub.id where sub.depth < 1000
    )
    select a.storage_key from attachments a where a.page_id in (select id from sub)`);
  return res.rows.map((r) => r.storage_key);
}

/** Remove file bytes after their rows are gone (DiskStorage.delete ignores a missing file). */
async function deleteBytes(storage: FileStorage, keys: string[]) {
  for (const key of keys) await storage.delete(key);
}

/**
 * Delete trash roots for good, in one transaction: the row delete cascades to
 * the sub-pages (and any earlier trash items under them), page_versions,
 * comments, attachment rows, favourites and views. Then the file bytes go.
 */
async function purgeRoots(db: Db, storage: FileStorage, rootIds: string[]): Promise<number> {
  if (rootIds.length === 0) return 0;
  const { keys, n } = await db.transaction(async (tx) => {
    const keys = await fileKeysUnder(tx, rootIds);
    const gone = await tx
      .delete(pages)
      .where(and(inArray(pages.id, rootIds), isNotNull(pages.deletedAt)))
      .returning({ id: pages.id });
    return { keys, n: gone.length };
  });
  await deleteBytes(storage, keys);
  return n;
}

/** Delete one trash item for good (space admin). */
export async function purgePage(db: Db, storage: FileStorage, user: SessionUser, pageId: string): Promise<void> {
  const page = await requireAnyPage(db, user, pageId, 'admin');
  requireTrashRoot(page, 'This page is not in the trash. Move it to the trash first.');
  await purgeRoots(db, storage, [page.id]);
}

/** Empty a space's trash (space admin). Returns how many items were purged. */
export async function emptyTrash(db: Db, storage: FileStorage, user: SessionUser, key: string): Promise<number> {
  const { space } = await requireSpaceByKey(db, user, key, 'admin');
  const roots = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.spaceId, space.id), isNotNull(pages.deletedAt), eq(pages.trashRootId, pages.id)));
  if (roots.length === 0) return 0;
  await purgeRoots(db, storage, roots.map((r) => r.id));
  // Every listed item was purged (an inner item may have gone with an outer one).
  return roots.length;
}

// ---- Spaces ----

/** Move a space to the trash (space admin). Its pages are not changed. */
export async function trashSpace(db: Db, user: SessionUser, key: string): Promise<void> {
  const { space } = await requireSpaceByKey(db, user, key, 'admin');
  await db
    .update(spaces)
    .set({ deletedAt: new Date(), deletedBy: user.id })
    .where(and(eq(spaces.id, space.id), isNull(spaces.deletedAt)));
}

/** Trashed spaces the user is a space admin of (all of them for an instance admin). */
export async function listTrashedSpaces(db: Db, user: SessionUser, retentionDays: number) {
  const rows = await db
    .select({ space: spaces, memberRole: spaceMembers.role, deletedByName: users.name })
    .from(spaces)
    .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, user.id)))
    .leftJoin(users, eq(users.id, spaces.deletedBy))
    .where(isNotNull(spaces.deletedAt))
    .orderBy(desc(spaces.deletedAt), desc(spaces.id));
  const items: TrashedSpace[] = [];
  for (const r of rows) {
    if (effectiveRole(user, r.space, r.memberRole ?? null) !== 'admin') continue;
    items.push({
      id: r.space.id,
      key: r.space.key,
      name: r.space.name,
      deletedAt: r.space.deletedAt!.toISOString(),
      deletedBy: person(r.space.deletedBy, r.deletedByName),
      purgeAt: purgeAt(r.space.deletedAt!, retentionDays),
    });
  }
  return { items };
}

/** A trashed space for its space admin or an instance admin. Everyone else: 404, the space stays hidden. */
async function requireTrashedSpaceAdmin(db: Db, user: SessionUser, spaceId: string) {
  try {
    return (await requireTrashedSpace(db, user, spaceId, 'admin')).space;
  } catch (err) {
    if ((err as { status?: number }).status === 403) throw notFound('Space not found');
    throw err;
  }
}

export async function restoreSpace(db: Db, user: SessionUser, spaceId: string) {
  const space = await requireTrashedSpaceAdmin(db, user, spaceId);
  await db.update(spaces).set({ deletedAt: null, deletedBy: null }).where(eq(spaces.id, space.id));
  return { space: { id: space.id, key: space.key, name: space.name } };
}

async function purgeSpaces(db: Db, storage: FileStorage, spaceIds: string[]): Promise<number> {
  if (spaceIds.length === 0) return 0;
  const { keys, n } = await db.transaction(async (tx) => {
    const files = await tx
      .select({ key: attachments.storageKey })
      .from(attachments)
      .where(inArray(attachments.spaceId, spaceIds));
    // Cascades remove the pages (and their history, comments, files, favourites
    // and views), the members and the templates.
    const gone = await tx
      .delete(spaces)
      .where(and(inArray(spaces.id, spaceIds), isNotNull(spaces.deletedAt)))
      .returning({ id: spaces.id });
    return { keys: files.map((f) => f.key), n: gone.length };
  });
  await deleteBytes(storage, keys);
  return n;
}

export async function purgeSpace(db: Db, storage: FileStorage, user: SessionUser, spaceId: string): Promise<void> {
  const space = await requireTrashedSpaceAdmin(db, user, spaceId);
  await purgeSpaces(db, storage, [space.id]);
}

// ---- Purge by time ----

/**
 * Delete for good every page item and space trashed `retentionDays` or more
 * before `now`, files included. retentionDays 0 = never. The server calls this
 * at start and then every hour (startTrashSweep); tests call it with a chosen time.
 */
export async function purgeExpired(
  db: Db,
  storage: FileStorage,
  now: Date = new Date(),
  retentionDays: number = env.trashRetentionDays,
): Promise<{ pages: number; spaces: number }> {
  if (retentionDays <= 0) return { pages: 0, spaces: 0 };
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const spaceRows = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(isNotNull(spaces.deletedAt), sql`${spaces.deletedAt} <= ${cutoff}`));
  const spacesPurged = await purgeSpaces(db, storage, spaceRows.map((r) => r.id));
  const roots = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(isNotNull(pages.deletedAt), eq(pages.trashRootId, pages.id), sql`${pages.deletedAt} <= ${cutoff}`));
  const pagesPurged = await purgeRoots(db, storage, roots.map((r) => r.id));
  return { pages: pagesPurged, spaces: spacesPurged };
}

export const TRASH_SWEEP_MS = 60 * 60 * 1000;

/** Run purgeExpired now and then every hour. Returns the stop function (called when the app closes). */
export function startTrashSweep(
  db: Db,
  storage: FileStorage,
  retentionDays: number,
  warn: (err: unknown) => void,
): () => void {
  const sweep = () => {
    purgeExpired(db, storage, new Date(), retentionDays).catch(warn);
  };
  sweep();
  const timer = setInterval(sweep, TRASH_SWEEP_MS);
  timer.unref();
  return () => clearInterval(timer);
}
