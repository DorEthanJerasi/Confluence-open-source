// GET /api/pages/:id/export?format=md|pdf&children=0|1 (docs/done-checks/16-export.md).
// Read-only: anyone who can read the page may export it (viewers included);
// someone who cannot is told the page does not exist (404); signed out is 401.
import type { FastifyInstance } from 'fastify';
import { exportQuery } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { contentDisposition } from '../files/attachments.js';
import { collectExport, DEFAULT_EXPORT_LIMITS, type ExportLimits } from '../export/collect.js';
import { buildMarkdownExport } from '../export/markdown.js';
import { buildPdfExport, pdfWantsBytes } from '../export/pdf.js';

export interface ExportRouteOptions {
  /** Lower limits for tests; the defaults are 200 pages and 100 MB of files. */
  limits?: Partial<ExportLimits>;
  /** false only in tests, so the PDF text can be read back. */
  pdfCompress?: boolean;
}

export async function exportRoutes(app: FastifyInstance, opts: ExportRouteOptions) {
  const limits: ExportLimits = { ...DEFAULT_EXPORT_LIMITS, ...opts.limits };

  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>('/:id/export', async (req, reply) => {
    const user = requireUser(req);
    const id = uuidParam(req.params.id, 'Page not found');
    const { format, children } = parse(exportQuery, req.query);
    const bundle = await collectExport(app.db, app.storage, user, id, {
      children,
      limits,
      publicUrl: app.config.publicUrl,
      wantsBytes: format === 'pdf' ? pdfWantsBytes : () => true,
    });
    const out = format === 'pdf' ? await buildPdfExport(bundle, { compress: opts.pdfCompress }) : buildMarkdownExport(bundle);
    return reply
      .header('content-type', out.contentType)
      .header('content-length', out.body.length)
      .header('content-disposition', contentDisposition('attachment', out.filename))
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
      .send(out.body);
  });
}
