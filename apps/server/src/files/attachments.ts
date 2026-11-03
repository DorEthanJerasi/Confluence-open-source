// Attachments: upload into a page's space, and serve back only to readers of
// that space (ARCHITECTURE.md §4 and §7; done-check 02-editor.md, 2b).
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Attachment } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { attachments } from '../db/schema.js';
import { requireSpaceRole } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { HttpError, notFound } from '../http.js';
import type { FileStorage } from './storage.js';
import type { Readable } from 'node:stream';

/** Only these are ever shown inline by the browser. SVG and HTML are not on the list. */
const INLINE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
]);

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

export function normalizeMime(raw: string | undefined): string {
  const m = (raw ?? '').split(';')[0]!.trim().toLowerCase();
  return MIME_RE.test(m) ? m : 'application/octet-stream';
}

export function isInlineMime(mime: string): boolean {
  return INLINE_MIME.has(mime);
}

/** A display name: no path, no control characters, at most 200 characters. */
export function cleanFilename(raw: string | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200);
  return name || 'file';
}

/** Content-Disposition with a plain ASCII fallback and the exact UTF-8 name. */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[\;]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const tooLarge = (maxBytes: number) =>
  new HttpError(413, 'too_large', `That file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);

/** Store the bytes, then the row. If either fails, neither is kept. */
export async function saveAttachment(
  db: Db,
  storage: FileStorage,
  input: { spaceId: string; pageId: string; userId: string; filename: string; mime: string; data: Readable & { truncated?: boolean } },
  maxBytes: number,
): Promise<Attachment> {
  const id = randomUUID();
  let size: number;
  try {
    size = await storage.put(id, input.data);
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(maxBytes);
    throw err;
  }
  if (input.data.truncated || size > maxBytes) {
    await storage.delete(id);
    throw tooLarge(maxBytes);
  }
  try {
    await db.insert(attachments).values({
      id,
      spaceId: input.spaceId,
      pageId: input.pageId,
      filename: input.filename,
      mime: input.mime,
      size,
      storageKey: id,
      createdBy: input.userId,
    });
  } catch (err) {
    await storage.delete(id);
    throw err;
  }
  return { id, filename: input.filename, mime: input.mime, size };
}

/** The attachment row, if the user can read its space. Everyone else: 404. */
export async function readableAttachment(db: Db, user: SessionUser | null, id: string) {
  const missing = () => notFound('File not found');
  if (!user) throw missing();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!row) throw missing();
  try {
    await requireSpaceRole(db, user, row.spaceId, 'viewer');
  } catch {
    throw missing();
  }
  return row;
}
