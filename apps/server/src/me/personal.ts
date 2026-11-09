// Favourites and recently viewed (docs/done-checks/09-favourites-recent.md).
// Both lists are personal. Writes check the page with requirePageRole
// ('viewer': anyone who can read a page may star it or record a view); lists
// filter when read with visibleSpaceIds and pages.deleted_at, so there is no
// second permission rule and nothing to clean up when access changes. Nothing
// here writes pages or page_versions.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { FAVOURITES_LIMIT, RECENT_LIMIT, VIEWS_KEPT, type FavouritePage, type RecentPage } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pageFavourites, pageViews, pages, spaces } from '../db/schema.js';
import { visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole } from '../pages/pages.js';

/** Add (on) or remove a favourite. Idempotent both ways. 404 if the page cannot be read. */
export async function setFavourite(db: Db, user: SessionUser, pageId: string, on: boolean): Promise<void> {
  await requirePageRole(db, user, pageId, 'viewer');
  if (on) {
    await db.insert(pageFavourites).values({ userId: user.id, pageId }).onConflictDoNothing();
  } else {
    await db.delete(pageFavourites).where(and(eq(pageFavourites.userId, user.id), eq(pageFavourites.pageId, pageId)));
  }
}

/** Record that the person opened the page now, keeping at most VIEWS_KEPT rows for them. */
export async function recordView(db: Db, user: SessionUser, pageId: string): Promise<void> {
  await requirePageRole(db, user, pageId, 'viewer');
  await db.transaction(async (tx) => {
    await tx
      .insert(pageViews)
      .values({ userId: user.id, pageId })
      .onConflictDoUpdate({ target: [pageViews.userId, pageViews.pageId], set: { viewedAt: sql`now()` } });
    await tx.execute(sql`
      delete from ${pageViews}
      where ${pageViews.userId} = ${user.id}
        and ${pageViews.pageId} in (
          select page_id from page_views where user_id = ${user.id}
          order by viewed_at desc, page_id desc
          offset ${VIEWS_KEPT})`);
  });
}

/** The person's own favourites they can still read, newest first. */
export async function listFavourites(db: Db, user: SessionUser): Promise<FavouritePage[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, key: spaces.key, name: spaces.name, at: pageFavourites.createdAt })
    .from(pageFavourites)
    .innerJoin(pages, eq(pages.id, pageFavourites.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(
      and(
        eq(pageFavourites.userId, user.id),
        isNull(pages.deletedAt),
        sql`${pages.spaceId} in (${visibleSpaceIds(user)})`,
      ),
    )
    .orderBy(desc(pageFavourites.createdAt), desc(pages.id))
    .limit(FAVOURITES_LIMIT);
  return rows.map((r) => ({ id: r.id, title: r.title, space: { key: r.key, name: r.name }, favouritedAt: r.at.toISOString() }));
}

/** The person's own recently viewed pages they can still read, newest first. */
export async function listRecent(db: Db, user: SessionUser): Promise<RecentPage[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, key: spaces.key, name: spaces.name, at: pageViews.viewedAt })
    .from(pageViews)
    .innerJoin(pages, eq(pages.id, pageViews.pageId))
    .innerJoin(spaces, eq(spaces.id, pages.spaceId))
    .where(
      and(eq(pageViews.userId, user.id), isNull(pages.deletedAt), sql`${pages.spaceId} in (${visibleSpaceIds(user)})`),
    )
    .orderBy(desc(pageViews.viewedAt), desc(pages.id))
    .limit(RECENT_LIMIT);
  return rows.map((r) => ({ id: r.id, title: r.title, space: { key: r.key, name: r.name }, viewedAt: r.at.toISOString() }));
}
