// Page comments (docs/done-checks/07-comments.md, 7a). All comment logic lives
// here. Every function checks access through requirePageRole, the same rule
// the page itself uses, so there is no second permission path: someone who
// cannot read the page gets 404, exactly as for the page.
//
// Comments are stored in page_comments only. Nothing here writes pages,
// page_versions or pages.version, so saving, history and a later Yjs document
// never see comments. Anchors are top-level block ids (or null = whole page).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { roleAtLeast, type Comment, type CommentList, type CommentPerson, type CommentReply, type CommentThread } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pageComments, pages, users } from '../db/schema.js';
import { requirePageRole } from '../pages/pages.js';
import type { SessionUser } from '../auth/session.js';
import { badRequest, forbidden, notFound } from '../http.js';

const authors = alias(users, 'comment_author');
const resolvers = alias(users, 'comment_resolver');

const columns = {
  id: pageComments.id,
  pageId: pageComments.pageId,
  parentId: pageComments.parentId,
  blockId: pageComments.blockId,
  body: pageComments.body,
  authorId: pageComments.authorId,
  authorName: authors.name,
  createdAt: pageComments.createdAt,
  editedAt: pageComments.editedAt,
  resolvedAt: pageComments.resolvedAt,
  resolvedById: pageComments.resolvedBy,
  resolvedByName: resolvers.name,
  deletedAt: pageComments.deletedAt,
};

type Row = {
  id: string;
  pageId: string;
  parentId: string | null;
  blockId: string | null;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  editedAt: Date | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  deletedAt: Date | null;
};

function selectRows(db: Db) {
  return db
    .select(columns)
    .from(pageComments)
    .leftJoin(authors, eq(authors.id, pageComments.authorId))
    .leftJoin(resolvers, eq(resolvers.id, pageComments.resolvedBy));
}

const person = (id: string | null, name: string | null): CommentPerson | null =>
  id && name !== null ? { id, name } : null;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toReply(r: Row): CommentReply {
  return { id: r.id, body: r.body, author: person(r.authorId, r.authorName), createdAt: r.createdAt.toISOString(), editedAt: iso(r.editedAt) };
}

function toComment(r: Row): Comment {
  return {
    ...toReply(r),
    ...(r.deletedAt ? { body: '', author: null, editedAt: null } : {}),
    pageId: r.pageId,
    parentId: r.parentId,
    blockId: r.blockId,
    resolvedAt: iso(r.resolvedAt),
    resolvedBy: person(r.resolvedById, r.resolvedByName),
  };
}

/** Ids of the top-level blocks of the page's current body. */
async function topLevelBlockIds(db: Db, pageId: string): Promise<Set<string>> {
  const [row] = await db.select({ doc: pages.doc }).from(pages).where(eq(pages.id, pageId));
  const ids = new Set<string>();
  const content = (row?.doc as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return ids;
  for (const block of content) {
    const id = (block as { attrs?: { id?: unknown } } | null)?.attrs?.id;
    if (typeof id === 'string' && id !== '') ids.add(id);
  }
  return ids;
}

async function loadRow(db: Db, commentId: string): Promise<Row | undefined> {
  const [row] = await selectRows(db).where(eq(pageComments.id, commentId));
  return row;
}

/**
 * A comment and the caller's role on its page. 404 when the comment does not
 * exist or its page cannot be read (missing, deleted or not visible).
 * Pass `allowDeleted` to also find soft-deleted comments.
 */
async function requireComment(db: Db, user: SessionUser, commentId: string, needed: 'viewer' | 'editor', allowDeleted = false) {
  const row = await loadRow(db, commentId);
  if (!row) throw notFound('Comment not found');
  let role;
  try {
    ({ role } = await requirePageRole(db, user, row.pageId, needed));
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw notFound('Comment not found');
    throw err;
  }
  if (row.deletedAt && !allowDeleted) throw notFound('Comment not found');
  return { row, role };
}

/** GET /api/pages/:id/comments. */
export async function listComments(db: Db, user: SessionUser, pageId: string): Promise<CommentList> {
  await requirePageRole(db, user, pageId, 'viewer');
  const rows = await selectRows(db)
    .where(eq(pageComments.pageId, pageId))
    .orderBy(asc(pageComments.createdAt), asc(pageComments.id));
  const blockIds = await topLevelBlockIds(db, pageId);

  const replies = new Map<string, CommentReply[]>();
  for (const r of rows) {
    if (!r.parentId || r.deletedAt) continue;
    const list = replies.get(r.parentId) ?? [];
    list.push(toReply(r));
    replies.set(r.parentId, list);
  }

  const threads: CommentThread[] = [];
  for (const r of rows) {
    if (r.parentId) continue;
    const own = replies.get(r.id) ?? [];
    const deleted = r.deletedAt !== null;
    // A deleted root with no live replies is gone; with replies it stays as "Comment deleted".
    if (deleted && own.length === 0) continue;
    threads.push({
      id: r.id,
      blockId: r.blockId,
      body: deleted ? '' : r.body,
      author: deleted ? null : person(r.authorId, r.authorName),
      createdAt: r.createdAt.toISOString(),
      editedAt: deleted ? null : iso(r.editedAt),
      resolvedAt: iso(r.resolvedAt),
      resolvedBy: person(r.resolvedById, r.resolvedByName),
      deleted,
      blockMissing: r.blockId !== null && !blockIds.has(r.blockId),
      replies: own,
    });
  }

  // Open threads first, oldest first (already in that order); then resolved, newest resolved first.
  const open = threads.filter((t) => !t.resolvedAt);
  const resolved = threads
    .filter((t) => t.resolvedAt)
    .sort((a, b) => (b.resolvedAt! < a.resolvedAt! ? -1 : b.resolvedAt! > a.resolvedAt! ? 1 : 0));
  return { threads: [...open, ...resolved] };
}

/** POST /api/pages/:id/comments. Anyone who can read the page may comment (a comment is not an edit). */
export async function createComment(
  db: Db,
  user: SessionUser,
  pageId: string,
  input: { body: string; blockId?: string | null; parentId?: string | null },
): Promise<Comment> {
  await requirePageRole(db, user, pageId, 'viewer');
  let blockId: string | null = null;
  let parentId: string | null = null;
  if (input.parentId) {
    const [root] = await db
      .select({ id: pageComments.id, parentId: pageComments.parentId, blockId: pageComments.blockId })
      .from(pageComments)
      .where(and(eq(pageComments.id, input.parentId), eq(pageComments.pageId, pageId), isNull(pageComments.deletedAt)));
    if (!root) throw badRequest('That comment is not on this page');
    if (root.parentId) throw badRequest('Reply to the first comment of the thread');
    parentId = root.id;
    blockId = root.blockId;
  } else if (input.blockId) {
    if (!(await topLevelBlockIds(db, pageId)).has(input.blockId)) throw badRequest('That block is not on this page');
    blockId = input.blockId;
  }
  const [row] = await db
    .insert(pageComments)
    .values({ pageId, parentId, blockId, authorId: user.id, body: input.body })
    .returning({ id: pageComments.id });
  return toComment((await loadRow(db, row!.id))!);
}

/** PATCH /api/comments/:id: the author only. */
export async function editComment(db: Db, user: SessionUser, commentId: string, body: string): Promise<Comment> {
  const { row } = await requireComment(db, user, commentId, 'viewer');
  if (row.authorId !== user.id) throw forbidden('Only the person who wrote a comment can edit it');
  await db
    .update(pageComments)
    .set({ body, editedAt: new Date() })
    .where(and(eq(pageComments.id, commentId), isNull(pageComments.deletedAt)));
  return toComment((await loadRow(db, commentId))!);
}

/** DELETE /api/comments/:id: the author, or an admin of the space. Soft delete; the body is cleared. */
export async function deleteComment(db: Db, user: SessionUser, commentId: string): Promise<void> {
  const { row, role } = await requireComment(db, user, commentId, 'viewer');
  if (row.authorId !== user.id && !roleAtLeast(role, 'admin')) {
    throw forbidden('Only the person who wrote a comment, or a space admin, can delete it');
  }
  await db
    .update(pageComments)
    .set({ deletedAt: new Date(), body: '' })
    .where(and(eq(pageComments.id, commentId), isNull(pageComments.deletedAt)));
}

/**
 * POST /api/comments/:id/resolve and /reopen: editors and up, roots only.
 * Doing it twice changes nothing. A deleted root still shown for its replies
 * can be resolved too, so such a thread is never stuck open.
 */
export async function setResolved(db: Db, user: SessionUser, commentId: string, resolved: boolean): Promise<Comment> {
  const { row } = await requireComment(db, user, commentId, 'editor', true);
  if (row.parentId) throw badRequest('Only a whole thread can be resolved, not a reply');
  if (resolved && !row.resolvedAt) {
    await db
      .update(pageComments)
      .set({ resolvedAt: sql`now()`, resolvedBy: user.id })
      .where(and(eq(pageComments.id, commentId), isNull(pageComments.resolvedAt)));
  } else if (!resolved && row.resolvedAt) {
    await db.update(pageComments).set({ resolvedAt: null, resolvedBy: null }).where(eq(pageComments.id, commentId));
  }
  return toComment((await loadRow(db, commentId))!);
}
