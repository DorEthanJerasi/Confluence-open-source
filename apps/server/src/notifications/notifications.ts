// Mentions, following and notifications (docs/done-checks/15-mentions.md, 15a).
//
// Writing: createPage, savePage and createComment call the `on…` functions
// below inside their own transaction, so a notification is never lost or
// doubled. Only people who can read the page at that moment are written one
// (the spacePeople rule: instance admin, open space, or member), never the
// person who acted, never a disabled person.
//
// Reading: every list and count is filtered when read by `visibleTo(user)`:
// a live page in a space from visibleSpaceIds, and for a comment notification
// a comment that is not deleted. The list and the unread count share that one
// filter, so they cannot disagree.
//
// Nothing here writes pages or page_versions: follows and notifications sit
// beside the document, so saving, history and a later co-editing server never
// see them.
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NOTIFICATIONS_PAGE_SIZE, type Notification } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { notifications, pageComments, pageFollows, pages, spaces, users } from '../db/schema.js';
import { visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole, type Tx } from '../pages/pages.js';
import { badRequest, notFound } from '../http.js';

// ---------- writing (inside the caller's transaction) ----------

/**
 * SQL condition on `u` (users) and `s` (spaces): the person is active, is not
 * the one who acted, and can read the space now.
 */
function canBeTold(actorId: string): SQL {
  return sql`u.disabled_at is null
    and u.id <> ${actorId}
    and s.deleted_at is null
    and (u.role = 'admin' or s.visibility = 'open'
         or exists (select 1 from space_members m where m.space_id = s.id and m.user_id = u.id))`;
}

/** Follow a page, keeping an earlier follow as it is. */
export async function followInTx(tx: Tx, userId: string, pageId: string) {
  await tx.insert(pageFollows).values({ userId, pageId }).onConflictDoNothing();
}

/**
 * The page was made (createPage): its creator follows it, and everyone
 * mentioned in its first doc is told.
 */
export async function onPageCreated(tx: Tx, p: { pageId: string; spaceId: string; actorId: string; mentions: Set<string> }) {
  await followInTx(tx, p.actorId, p.pageId);
  await tellMentioned(tx, p.pageId, p.spaceId, p.actorId, [...p.mentions]);
}

/**
 * The page was saved (savePage): each person newly mentioned (in `after`, not
 * in `before`) gets a mention; every follower gets an edit, folded into their
 * unread edit notification for this page if they have one.
 */
export async function onPageSaved(
  tx: Tx,
  p: { pageId: string; spaceId: string; actorId: string; before: Set<string>; after: Set<string> },
) {
  const added = [...p.after].filter((id) => !p.before.has(id));
  await tellMentioned(tx, p.pageId, p.spaceId, p.actorId, added);
  await tx.execute(sql`
    insert into notifications (user_id, kind, page_id, actor_id)
    select u.id, 'edit', ${p.pageId}, ${p.actorId}
    from page_follows f
    join users u on u.id = f.user_id
    join spaces s on s.id = ${p.spaceId}
    where f.page_id = ${p.pageId} and ${canBeTold(p.actorId)}
    on conflict (user_id, page_id) where kind = 'edit' and read_at is null
    do update set actor_id = excluded.actor_id, count = notifications.count + 1, created_at = now()`);
}

/** A comment or reply was posted (createComment): the commenter follows the page, every follower is told. */
export async function onCommentPosted(tx: Tx, c: { pageId: string; spaceId: string; actorId: string; commentId: string }) {
  await followInTx(tx, c.actorId, c.pageId);
  await tx.execute(sql`
    insert into notifications (user_id, kind, page_id, actor_id, comment_id)
    select u.id, 'comment', ${c.pageId}, ${c.actorId}, ${c.commentId}
    from page_follows f
    join users u on u.id = f.user_id
    join spaces s on s.id = ${c.spaceId}
    where f.page_id = ${c.pageId} and ${canBeTold(c.actorId)}`);
}

async function tellMentioned(tx: Tx, pageId: string, spaceId: string, actorId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const ids = sql.join(
    userIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // An id that is nobody here, or someone who cannot read the space, matches no row: nobody is told.
  await tx.execute(sql`
    insert into notifications (user_id, kind, page_id, actor_id)
    select u.id, 'mention', ${pageId}, ${actorId}
    from users u
    join spaces s on s.id = ${spaceId}
    where u.id in (${ids}) and ${canBeTold(actorId)}`);
}

// ---------- following (routes) ----------

/** PUT / DELETE /api/pages/:id/follow. Anyone who can read the page; twice changes nothing. */
export async function setFollow(db: Db, user: SessionUser, pageId: string, on: boolean): Promise<{ following: boolean }> {
  await requirePageRole(db, user, pageId, 'viewer');
  if (on) {
    await db.insert(pageFollows).values({ userId: user.id, pageId }).onConflictDoNothing();
  } else {
    await db.delete(pageFollows).where(and(eq(pageFollows.userId, user.id), eq(pageFollows.pageId, pageId)));
  }
  return { following: on };
}

/** SQL for getPageView: whether `userId` follows the page in `pageIdCol`. */
export function followingSql(userId: string, pageIdCol: SQL | typeof pages.id): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${pageFollows} where ${pageFollows.userId} = ${userId} and ${pageFollows.pageId} = ${pageIdCol})`;
}

// ---------- reading (the person's own only) ----------

const actors = alias(users, 'notification_actor');

/**
 * The one read filter: the person's own notifications about a live page in a
 * space they can read now, and for a comment one, a comment not deleted.
 * Needs notifications joined to pages and (left) page_comments.
 */
function visibleTo(user: SessionUser): SQL {
  return and(
    eq(notifications.userId, user.id),
    isNull(pages.deletedAt),
    sql`${pages.spaceId} in (${visibleSpaceIds(user)})`,
    sql`(${notifications.commentId} is null or ${pageComments.deletedAt} is null)`,
  )!;
}

/** GET /api/me/notifications/unread: the same joins and filter as the list, unread only. */
export async function unreadCount(db: Db, user: SessionUser): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .innerJoin(pages, eq(pages.id, notifications.pageId))
    .leftJoin(pageComments, eq(pageComments.id, notifications.commentId))
    .where(and(visibleTo(user), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/**
 * GET /api/me/notifications: newest first, NOTIFICATIONS_PAGE_SIZE at a time.
 * `before` is the id of the last one already shown (one of the person's own).
 * Titles and names are read now, never stored, so a rename shows at once.
 */
export async function listNotifications(
  db: Db,
  user: SessionUser,
  before?: string,
): Promise<{ notifications: Notification[]; more: boolean }> {
  let cursor: SQL | undefined;
  if (before) {
    const [at] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, before), eq(notifications.userId, user.id)));
    if (!at) throw badRequest('That notification is gone; open the list again');
    // Compared in SQL so created_at keeps its full precision.
    cursor = sql`(${notifications.createdAt}, ${notifications.id}) < ((select created_at from notifications where id = ${before}), ${before}::uuid)`;
  }
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      pageId: pages.id,
      title: pages.title,
      spaceKey: spaces.key,
      spaceName: spaces.name,
      actorId: notifications.actorId,
      actorName: actors.name,
      commentId: notifications.commentId,
      count: notifications.count,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .innerJoin(pages, eq(pages.id, notifications.pageId))
    .leftJoin(pageComments, eq(pageComments.id, notifications.commentId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .leftJoin(actors, eq(actors.id, notifications.actorId))
    .where(cursor ? and(visibleTo(user), cursor) : visibleTo(user))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATIONS_PAGE_SIZE + 1);
  return {
    notifications: rows.slice(0, NOTIFICATIONS_PAGE_SIZE).map((r) => ({
      id: r.id,
      kind: r.kind,
      page: { id: r.pageId, title: r.title, space: { key: r.spaceKey, name: r.spaceName } },
      actor: r.actorId && r.actorName !== null ? { id: r.actorId, name: r.actorName } : null,
      commentId: r.commentId,
      count: r.count,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
    })),
    more: rows.length > NOTIFICATIONS_PAGE_SIZE,
  };
}

/**
 * POST /api/me/notifications/read: mark some of the person's own (by id) or
 * all of them as read. Ids that are not theirs are ignored; 404 if none are.
 * Returns the unread count left.
 */
export async function markRead(db: Db, user: SessionUser, body: { ids: string[] } | { all: true }): Promise<number> {
  if ('all' in body) {
    await db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  } else {
    const ids = sql.join(
      body.ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const hit = await db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.userId, user.id), sql`${notifications.id} in (${ids})`))
      .returning({ id: notifications.id });
    if (hit.length === 0) throw notFound('Notification not found');
  }
  return unreadCount(db, user);
}
