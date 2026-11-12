// Page locks (docs/done-checks/17-locks.md). A lock is a flag on the page row
// (locked_at, locked_by): while it is set, the page's title and body cannot be
// changed by anyone. The one check is inside savePage's own update statement
// (pages.ts), so saving, restoring a version and ticking a task are refused
// there; trashPage checks the whole branch in its own transaction
// (trash/trash.ts). This file is the only writer of the two columns.
//
// Locking and unlocking never touch version, updated_at, updated_by, the
// document, the search text or page_versions, so a lock is never an edit.
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PageLock } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pages, users } from '../db/schema.js';
import type { SessionUser } from '../auth/session.js';
import { HttpError, notFound } from '../http.js';
import { requirePageRole, type Tx } from './pages.js';

type Reader = Db | Tx;

/** The lock of a live page now (null when unlocked); 404 when the page is gone. */
export async function readLock(db: Reader, pageId: string): Promise<PageLock | null> {
  const [row] = await db
    .select({ at: pages.lockedAt, byId: pages.lockedBy, byName: users.name })
    .from(pages)
    .leftJoin(users, eq(users.id, pages.lockedBy))
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)));
  if (!row) throw notFound('Page not found');
  return toLock(row.at, row.byId, row.byName);
}

export function toLock(at: Date | null, byId: string | null, byName: string | null): PageLock | null {
  if (!at) return null;
  return { at: at.toISOString(), by: byId && byName !== null ? { id: byId, name: byName } : null };
}

/** "locked by Ada Lind" or just "locked" when that person is gone. */
const lockedBy = (name: string | null | undefined) => (name ? `locked by ${name}` : 'locked');

/** 423 for a change to a locked page's title or body. */
export function pageLocked(name: string | null | undefined): HttpError {
  return new HttpError(423, 'page_locked', `This page is ${lockedBy(name)}. Unlock it to make changes.`);
}

/** 423 for trashing a page with a locked page under it. */
export function subPageLocked(title: string, name: string | null | undefined): HttpError {
  return new HttpError(423, 'page_locked', `“${title || 'Untitled'}” under this page is ${lockedBy(name)}. Unlock it first.`);
}

/**
 * Lock a live page (editor and up). Already locked: nothing is written and
 * the current lock is returned, so a double click or two people at once do
 * no harm.
 */
export async function lockPage(db: Db, user: SessionUser, pageId: string): Promise<{ lock: PageLock | null }> {
  await requirePageRole(db, user, pageId, 'editor');
  await db
    .update(pages)
    .set({ lockedAt: sql`now()`, lockedBy: user.id })
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt), isNull(pages.lockedAt)));
  return { lock: await readLock(db, pageId) };
}

/** Unlock a live page (editor and up, not only the one who locked it). Not locked: nothing is written. */
export async function unlockPage(db: Db, user: SessionUser, pageId: string): Promise<{ lock: PageLock | null }> {
  await requirePageRole(db, user, pageId, 'editor');
  await db
    .update(pages)
    .set({ lockedAt: null, lockedBy: null })
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt), isNotNull(pages.lockedAt)));
  return { lock: await readLock(db, pageId) };
}
