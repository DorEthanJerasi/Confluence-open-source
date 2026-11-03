// Page history reads and restore (ARCHITECTURE.md §5, done-check 03 "3b").
// Permission is checked by the routes through requirePageRole before these run.
// Snapshots are only ever written by createPage and savePage (pages.ts).
import { and, desc, eq, lt } from 'drizzle-orm';
import { savePageBody, type PageVersion, type PageVersionList, type PageVersionSummary } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pageVersions, users } from '../db/schema.js';
import { notFound } from '../http.js';
import { savePage } from './pages.js';

/** Snapshots per page of the version list. */
export const VERSION_PAGE_SIZE = 50;

const summaryColumns = {
  version: pageVersions.version,
  title: pageVersions.title,
  authorId: pageVersions.authorId,
  authorName: users.name,
  savedAt: pageVersions.savedAt,
  restoredFrom: pageVersions.restoredFrom,
};

type SummaryRow = { version: number; title: string; authorId: string | null; authorName: string | null; savedAt: Date; restoredFrom: number | null };

function toSummary(r: SummaryRow): PageVersionSummary {
  return {
    version: r.version,
    title: r.title,
    author: r.authorId && r.authorName !== null ? { id: r.authorId, name: r.authorName } : null,
    savedAt: r.savedAt.toISOString(),
    restoredFrom: r.restoredFrom,
  };
}

/** Newest first, VERSION_PAGE_SIZE at a time, only versions below `before` when given. */
export async function listVersions(db: Db, pageId: string, before?: number): Promise<PageVersionList> {
  const rows = await db
    .select(summaryColumns)
    .from(pageVersions)
    .leftJoin(users, eq(users.id, pageVersions.authorId))
    .where(and(eq(pageVersions.pageId, pageId), before !== undefined ? lt(pageVersions.version, before) : undefined))
    .orderBy(desc(pageVersions.version))
    .limit(VERSION_PAGE_SIZE + 1);
  const page = rows.slice(0, VERSION_PAGE_SIZE);
  return {
    versions: page.map(toSummary),
    nextBefore: rows.length > VERSION_PAGE_SIZE ? page.at(-1)!.version : null,
  };
}

/** One snapshot of this page, with its doc; 404 if the page has no such version. */
export async function getVersion(db: Db, pageId: string, version: number): Promise<PageVersion> {
  const [row] = await db
    .select({ ...summaryColumns, doc: pageVersions.doc })
    .from(pageVersions)
    .leftJoin(users, eq(users.id, pageVersions.authorId))
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.version, version)));
  if (!row) throw notFound('Version not found');
  return { ...toSummary(row), doc: row.doc };
}

/**
 * Restore never deletes: the old title and doc are written as a new current
 * version through savePage (same validation, same 409 on a stale baseVersion),
 * which adds a snapshot marked restored_from = version.
 */
export async function restoreVersion(
  db: Db,
  pageId: string,
  version: number,
  baseVersion: number,
  userId: string,
): Promise<{ version: number }> {
  const old = await getVersion(db, pageId, version);
  const body = savePageBody.parse({ baseVersion, title: old.title, doc: old.doc });
  return savePage(db, pageId, { title: body.title, doc: body.doc }, body.baseVersion, userId, { restoredFrom: version });
}
