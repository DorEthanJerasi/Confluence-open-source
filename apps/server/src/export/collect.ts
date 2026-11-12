// Export, part 1: what goes in (docs/done-checks/16-export.md, Decisions).
// Reads only: the page (through requirePageRole, the one permission path),
// its live sub-pages, their saved documents, the files they show (each one
// through readableAttachment) and the names of people they mention. Nothing
// here writes any table, and nothing here fetches from the internet.
import { inArray, sql } from 'drizzle-orm';
import { EXPORT_MAX_FILE_BYTES, EXPORT_MAX_PAGES } from '@stillwater/shared';
import { formatBytes, parseDoc } from '@stillwater/editor-schema';
import type { Db } from '../db/client.js';
import { pages, users } from '../db/schema.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole } from '../pages/pages.js';
import { readableAttachment } from '../files/attachments.js';
import type { FileStorage } from '../files/storage.js';
import { HttpError } from '../http.js';

/** A parsed page document (a ProseMirror node of the one schema). */
export type PmNode = ReturnType<typeof parseDoc>;

export interface ExportLimits {
  maxPages: number;
  maxFileBytes: number;
}

export const DEFAULT_EXPORT_LIMITS: ExportLimits = { maxPages: EXPORT_MAX_PAGES, maxFileBytes: EXPORT_MAX_FILE_BYTES };

export interface ExportPage {
  id: string;
  title: string;
  /** 0 for the page that was exported, 1 for its sub-pages, … */
  depth: number;
  doc: PmNode;
  children: ExportPage[];
}

/** A file the user may read, as stored. `data` is null when its bytes were not needed. */
export interface ExportFile {
  id: string;
  filename: string;
  mime: string;
  size: number;
  data: Buffer | null;
}

export interface ExportBundle {
  root: ExportPage;
  /** Every page in the export, in sidebar order (the root first, then depth first). */
  pages: ExportPage[];
  space: { key: string; name: string };
  /** Readable files by attachment id. A file block whose id is not here is "not available". */
  files: Map<string, ExportFile>;
  /** Current names of the people mentioned or given tasks, by user id (lower-case). */
  people: Map<string, string>;
  exportedBy: string;
  exportedAt: Date;
  publicUrl: string;
}

export interface CollectOptions {
  children: boolean;
  limits: ExportLimits;
  publicUrl: string;
  /** Which readable files need their bytes in the export (the rest only need their name and size). */
  wantsBytes: (file: { mime: string }) => boolean;
}

const tooLargeExport = (what: string, limit: string) =>
  new HttpError(413, 'export_too_large', `This export is too large: ${what}, the limit is ${limit}. Export a smaller part of the tree.`);

/** Sidebar order: by position (fractional keys compare by code unit), then id. */
function bySidebar(a: { position: string; id: string }, b: { position: string; id: string }) {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Attachment ids used by image, file and video blocks, in document order. */
function attachmentIds(doc: PmNode): string[] {
  const ids: string[] = [];
  doc.descendants((n) => {
    if ((n.type.name === 'image' || n.type.name === 'file' || n.type.name === 'video') && typeof n.attrs.attachmentId === 'string') {
      ids.push(n.attrs.attachmentId.toLowerCase());
    }
  });
  return ids;
}

/** User ids named by mentions and task assignees. */
function personIds(doc: PmNode): string[] {
  const ids: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'mention' && typeof n.attrs.userId === 'string') ids.push(n.attrs.userId.toLowerCase());
    if (n.type.name === 'taskItem' && typeof n.attrs.assignee === 'string') ids.push(n.attrs.assignee.toLowerCase());
  });
  return ids;
}

function safeParse(doc: unknown): PmNode {
  try {
    return parseDoc(doc);
  } catch {
    // Stored documents were checked when saved; one that no longer fits is exported empty, not a 500.
    return parseDoc({ type: 'doc', content: [] });
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(parts);
}

/**
 * Everything one export needs, or an HttpError: 404 when the user cannot read
 * the page (or it is in the trash), 413 when it is over the limits. The limits
 * are checked before any document is parsed or any file byte is read.
 */
export async function collectExport(
  db: Db,
  storage: FileStorage,
  user: SessionUser,
  pageId: string,
  opts: CollectOptions,
): Promise<ExportBundle> {
  const { space } = await requirePageRole(db, user, pageId, 'viewer');

  // The page walk: down parent_id, never into a trashed page (trash marks a
  // whole branch, so stopping there leaves out everything under it).
  const walk = await db.execute<{ id: string; parent_id: string | null; position: string; depth: number }>(
    opts.children
      ? sql`
        with recursive tree as (
          select id, parent_id, position, 0 as depth from pages where id = ${pageId} and deleted_at is null
          union all
          select p.id, p.parent_id, p.position, tree.depth + 1 from pages p join tree on p.parent_id = tree.id
          where p.deleted_at is null and p.space_id = ${space.id} and tree.depth < 1000
        )
        select id, parent_id, position, depth from tree`
      : sql`select id, parent_id, position, 0 as depth from pages where id = ${pageId} and deleted_at is null`,
  );
  const rows = walk.rows;
  if (rows.length === 0) throw new HttpError(404, 'not_found', 'Page not found');
  if (rows.length > opts.limits.maxPages) {
    throw tooLargeExport(`${rows.length} pages`, `${opts.limits.maxPages}`);
  }

  const stored = await db
    .select({ id: pages.id, title: pages.title, doc: pages.doc })
    .from(pages)
    .where(inArray(pages.id, rows.map((r) => r.id)));
  const byId = new Map(stored.map((s) => [s.id, s]));

  // Build the tree in sidebar order.
  const nodes = new Map<string, ExportPage & { position: string; parentId: string | null }>();
  for (const r of rows) {
    const s = byId.get(r.id);
    if (!s) continue;
    nodes.set(r.id, { id: r.id, title: s.title, depth: Number(r.depth), doc: safeParse(s.doc), children: [], position: r.position, parentId: r.parent_id });
  }
  const root = nodes.get(pageId);
  if (!root) throw new HttpError(404, 'not_found', 'Page not found');
  for (const n of [...nodes.values()].sort(bySidebar)) {
    if (n.id === pageId || !n.parentId) continue;
    nodes.get(n.parentId)?.children.push(n);
  }
  const ordered: ExportPage[] = [];
  const visit = (p: ExportPage) => {
    ordered.push(p);
    p.children.forEach(visit);
  };
  visit(root);

  // Files: only those this user may read, checked one by one.
  const wanted = [...new Set(ordered.flatMap((p) => attachmentIds(p.doc)))];
  const readable: { id: string; filename: string; mime: string; size: number; storageKey: string }[] = [];
  for (const id of wanted) {
    try {
      readable.push(await readableAttachment(db, user, id));
    } catch {
      /* not readable: shown as "not available" */
    }
  }
  const needed = readable.filter((f) => opts.wantsBytes(f));
  const total = needed.reduce((sum, f) => sum + f.size, 0);
  if (total > opts.limits.maxFileBytes) {
    throw tooLargeExport(`${formatBytes(total)} of files`, formatBytes(opts.limits.maxFileBytes));
  }
  const files = new Map<string, ExportFile>();
  for (const f of readable) {
    let data: Buffer | null = null;
    if (opts.wantsBytes(f)) {
      const stream = await storage.get(f.storageKey);
      if (!stream) continue; // bytes gone: not available
      data = await readAll(stream);
    }
    files.set(f.id.toLowerCase(), { id: f.id, filename: f.filename, mime: f.mime, size: f.size, data });
  }

  const ids = [...new Set(ordered.flatMap((p) => personIds(p.doc)))];
  const people = new Map<string, string>();
  if (ids.length > 0) {
    for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))) {
      people.set(u.id.toLowerCase(), u.name);
    }
  }

  return {
    root,
    pages: ordered,
    space: { key: space.key, name: space.name },
    files,
    people,
    exportedBy: user.name,
    exportedAt: new Date(),
    publicUrl: opts.publicUrl.replace(/\/+$/, ''),
  };
}

/** The wiki address of a page, which still needs sign-in. */
export function pageUrl(bundle: Pick<ExportBundle, 'publicUrl' | 'space'>, pageId: string, spaceKey = bundle.space.key): string {
  return `${bundle.publicUrl}/s/${encodeURIComponent(spaceKey)}/p/${pageId}`;
}

const PAGE_LINK = /^(?:https?:\/\/[^/]+)?\/s\/([^/?#]+)\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#].*)?$/i;

/**
 * What a link in a page points to in an export: another page of the same
 * export (`page`), or an address (`url`). Links into the wiki (a path, or the
 * wiki's own address) become full wiki addresses; other links stay as they are.
 */
export function resolveLink(
  bundle: Pick<ExportBundle, 'publicUrl' | 'space' | 'pages'>,
  href: string,
): { page: ExportPage } | { url: string } {
  const h = href.trim();
  const isOwn = h.startsWith('/') || h.toLowerCase().startsWith(bundle.publicUrl.toLowerCase() + '/');
  const m = isOwn ? PAGE_LINK.exec(h) : null;
  if (m) {
    const id = m[2]!.toLowerCase();
    const page = bundle.pages.find((p) => p.id.toLowerCase() === id);
    if (page) return { page };
    return { url: pageUrl(bundle, id, decodeURIComponent(m[1]!)) };
  }
  if (h.startsWith('/') && !h.startsWith('//')) return { url: bundle.publicUrl + h };
  return { url: h };
}

/** A file name for the download: no path, quotes or control characters; never empty. */
export function downloadName(title: string, ext: string): string {
  const base = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"*:<>?|]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 150)
    .trim();
  return `${base || 'untitled'}.${ext}`;
}
