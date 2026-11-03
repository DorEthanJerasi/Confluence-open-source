// POST /api/pages/:id/attachments and GET /api/attachments/:id
// (done-check 02-editor.md, 2b Build).
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guard.js';
import { badRequest, notFound, uuidParam } from '../http.js';
import { requirePageRole } from '../pages/pages.js';
import {
  cleanFilename,
  contentDisposition,
  isInlineMime,
  normalizeMime,
  readableAttachment,
  saveAttachment,
  tooLarge,
} from '../files/attachments.js';

type IdParams = { Params: { id: string } };

export async function attachmentRoutes(app: FastifyInstance) {
  const { db, storage, config } = app;

  app.post<IdParams>('/pages/:id/attachments', async (req, reply) => {
    const user = requireUser(req);
    const pageId = uuidParam(req.params.id, 'Page not found');
    // Permission first, before a single byte is read: viewers 403, non-members 404.
    const { space } = await requirePageRole(db, user, pageId, 'editor');
    if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > config.maxUploadBytes + 64 * 1024) throw tooLarge(config.maxUploadBytes);
    let part;
    try {
      part = await req.file();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(config.maxUploadBytes);
      throw err;
    }
    if (!part) throw badRequest('No file was sent');
    const attachment = await saveAttachment(
      db,
      storage,
      {
        spaceId: space.id,
        pageId,
        userId: user.id,
        filename: cleanFilename(part.filename),
        mime: normalizeMime(part.mimetype),
        data: part.file,
      },
      config.maxUploadBytes,
    );
    return reply.status(201).send(attachment);
  });

  app.get<IdParams>('/attachments/:id', async (req, reply) => {
    const id = uuidParam(req.params.id, 'File not found');
    const row = await readableAttachment(db, req.user, id);
    const body = await storage.get(row.storageKey);
    if (!body) throw notFound('File not found');
    const inline = isInlineMime(row.mime);
    return reply
      .header('content-type', row.mime)
      .header('content-length', row.size)
      .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', row.filename))
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=3600')
      .send(body);
  });
}
