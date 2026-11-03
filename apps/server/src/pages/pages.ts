// Page storage: create, read, save, move, delete. Permission checks happen in
// the routes before these are called. savePage is the ONLY writer of
// pages.doc (ARCHITECTURE.md §3, rule 5).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { EMPTY_DOC, type Crumb, type Doc, type Page, type Role } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pages, spaces, users } from '../db/schema.js';
import { requireSpaceRole } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { badRequest, conflict, notFound } from '../http.js';
import { normalizeDoc } from './docText.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Fractional-index keys compare by code unit, so sort with the C collation. */
export const byPosition = sql`${pages.position} collate "C"`;

/** Serialises tree changes (create/move) within one space. */
async function lockSpaceTree(tx: Tx, spaceId: string) {
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

export async function createPage(
  db: Db,
  input: { spaceId: string; userId: string; title: string; parentId: string | null; doc?: Doc },
): Promise<string> {
  const { doc, text } = normalizeDoc(input.doc ?? EMPTY_DOC);
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
      .returning({ id: pages.id });
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
    .select({ page: pages, spaceKey: spaces.key, updatedByName: users.name })
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
  };
}

/**
 * The single write path for a page's title and body. Optimistic concurrency:
 * the caller sends the version it started from; a stale one is refused with 409.
 * (Page history snapshots hook in here in the history stage.)
 */
export async function savePage(
  db: Db,
  pageId: string,
  change: { title?: string; doc?: Doc },
  baseVersion: number,
  userId: string,
): Promise<{ version: number }> {
  const body = change.doc !== undefined ? normalizeDoc(change.doc) : undefined;
  const [row] = await db
    .update(pages)
    .set({
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(body ? { doc: body.doc, docText: body.text } : {}),
      version: sql`${pages.version} + 1`,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(pages.id, pageId), eq(pages.version, baseVersion), isNull(pages.deletedAt)))
    .returning({ version: pages.version });
  if (row) return row;
  const [current] = await db
    .select({ version: pages.version })
    .from(pages)
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)));
  if (!current) throw notFound('Page not found');
  throw conflict('stale_version', `This page was changed by someone else (now version ${current.version}). Reload to get the latest.`);
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

/** Soft-delete a page and everything under it. */
export async function deletePage(db: Db, pageId: string): Promise<number> {
  const res = await db.execute(sql`
    with recursive sub as (
      select id from pages where id = ${pageId} and deleted_at is null
      union all
      select p.id from pages p join sub on p.parent_id = sub.id where p.deleted_at is null
    )
    update pages set deleted_at = now() where id in (select id from sub)`);
  return res.rowCount ?? 0;
}
