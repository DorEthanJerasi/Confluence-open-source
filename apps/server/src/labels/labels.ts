// Labels (docs/done-checks/13-labels.md, 13a). A label sits beside a page in
// its own two tables (labels, page_labels), never in pages.doc. Nothing here
// writes pages or page_versions or calls savePage, so labelling never changes
// a page's version and never causes a save conflict. Add and remove are set
// operations: adding one the page has, or removing one it lacks, is no change.
// Access goes through the one permission path (requirePageRole,
// requireSpaceByKey, visibleSpaceIds), and every read is filtered when read:
// live pages (deleted_at is null) in spaces the person can see now.
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import {
  LABELS_PER_PAGE,
  LABEL_NAME_MESSAGE,
  LABEL_SUGGESTIONS_LIMIT,
  LABEL_VIEW_LIMIT,
  normaliseLabel,
  type Label,
  type LabelSuggestion,
  type LabelView,
} from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { labels, pageLabels } from '../db/schema.js';
import { requireSpaceByKey, visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole } from '../pages/pages.js';
import { badRequest } from '../http.js';
import { labelsJson } from './labelSql.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's labels, by name. The caller has checked the page may be read. */
async function labelsOfPage(db: Pick<Db, 'select'>, pageId: string): Promise<Label[]> {
  return db
    .select({ id: labels.id, name: labels.name })
    .from(pageLabels)
    .innerJoin(labels, eq(labels.id, pageLabels.labelId))
    .where(eq(pageLabels.pageId, pageId))
    .orderBy(asc(labels.name));
}

/**
 * Add a label to a page (editor and up). Makes the labels row if the name is
 * new; a name used before keeps its id. Already on the page: no change. A page
 * holds at most LABELS_PER_PAGE labels; adds to one page are serialised so two
 * at once cannot pass the limit together.
 */
export async function addLabel(db: Db, user: SessionUser, pageId: string, raw: string): Promise<Label[]> {
  await requirePageRole(db, user, pageId, 'editor');
  const name = normaliseLabel(raw);
  if (!name) throw badRequest(LABEL_NAME_MESSAGE);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stillwater:labels:' + pageId}))`);
    await tx.insert(labels).values({ name, createdBy: user.id }).onConflictDoNothing({ target: labels.name });
    const [label] = await tx.select({ id: labels.id }).from(labels).where(eq(labels.name, name));
    const current = await labelsOfPage(tx, pageId);
    if (current.some((l) => l.id === label!.id)) return current;
    if (current.length >= LABELS_PER_PAGE) throw badRequest(`A page can have at most ${LABELS_PER_PAGE} labels`);
    await tx.insert(pageLabels).values({ pageId, labelId: label!.id, addedBy: user.id }).onConflictDoNothing();
    return labelsOfPage(tx, pageId);
  });
}

/** Remove a label from a page (editor and up). Not on the page: no change. */
export async function removeLabel(db: Db, user: SessionUser, pageId: string, labelId: string): Promise<Label[]> {
  await requirePageRole(db, user, pageId, 'editor');
  // An id that is not a uuid can never be on the page: nothing to remove.
  if (UUID_RE.test(labelId)) {
    await db.delete(pageLabels).where(and(eq(pageLabels.pageId, pageId), eq(pageLabels.labelId, labelId)));
  }
  return labelsOfPage(db, pageId);
}

/** Escape LIKE wildcards so text is matched as written. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `q` in the shape of a label name, for matching (not checked against the rule). */
const labelLike = (q: string) => q.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-');

/**
 * Names on live pages the person can see, with how many such pages. With `q`,
 * only names containing it, those starting with it first; then by count, then
 * name. A label on no page they can see is not listed at all.
 */
export async function suggestLabels(db: Db, user: SessionUser, q?: string): Promise<LabelSuggestion[]> {
  const text = q ? labelLike(q) : '';
  const match = text ? sql`and l.name like ${`%${escapeLike(text)}%`}` : sql``;
  const starts = text ? sql`(l.name like ${`${escapeLike(text)}%`}) desc, ` : sql``;
  const res = await db.execute<{ id: string; name: string; count: string }>(sql`
    select l.id, l.name, count(*) as count
    from ${labels} l
    join ${pageLabels} pl on pl.label_id = l.id
    join pages p on p.id = pl.page_id
    where p.deleted_at is null
      and p.space_id in (${visibleSpaceIds(user)})
      ${match}
    group by l.id, l.name
    order by ${starts}count(*) desc, l.name
    limit ${LABEL_SUGGESTIONS_LIMIT}`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }));
}

/** Live pages the person can see with the label, newest change first, at most LABEL_VIEW_LIMIT. */
async function labelView(db: Db, user: SessionUser, rawName: string, spaceFilter: SQL): Promise<LabelView> {
  const empty: LabelView = { label: null, pages: [], truncated: false };
  const name = normaliseLabel(rawName);
  if (!name) return empty;
  const [label] = await db.select({ id: labels.id, name: labels.name }).from(labels).where(eq(labels.name, name));
  if (!label) return empty;
  const res = await db.execute<{
    id: string;
    title: string;
    space_key: string;
    space_name: string;
    updated_at: Date | string;
    labels: Label[];
  }>(sql`
    select p.id, p.title, s.key as space_key, s.name as space_name, p.updated_at, ${labelsJson(sql`p.id`)} as labels
    from ${pageLabels} pl
    join pages p on p.id = pl.page_id
    join spaces s on s.id = p.space_id
    where pl.label_id = ${label.id}
      and p.deleted_at is null
      and p.space_id in (${visibleSpaceIds(user)})
      ${spaceFilter}
    order by p.updated_at desc, p.id
    limit ${LABEL_VIEW_LIMIT + 1}`);
  // A label with no page the person can see looks the same as one never used.
  if (res.rows.length === 0) return empty;
  return {
    label,
    pages: res.rows.slice(0, LABEL_VIEW_LIMIT).map((r) => ({
      id: r.id,
      title: r.title,
      space: { key: r.space_key, name: r.space_name },
      updatedAt: new Date(r.updated_at).toISOString(),
      labels: r.labels,
    })),
    truncated: res.rows.length > LABEL_VIEW_LIMIT,
  };
}

/** The whole-wiki label view. */
export function wikiLabelView(db: Db, user: SessionUser, name: string): Promise<LabelView> {
  return labelView(db, user, name, sql``);
}

/** One space's label view (viewer and up; a space they cannot read is 404). */
export async function spaceLabelView(db: Db, user: SessionUser, key: string, name: string): Promise<LabelView> {
  const { space } = await requireSpaceByKey(db, user, key, 'viewer');
  return labelView(db, user, name, sql`and p.space_id = ${space.id}`);
}
