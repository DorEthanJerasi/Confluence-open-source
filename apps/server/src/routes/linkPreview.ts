// GET /api/link-preview?url=… (done-check 02-editor.md, 2b): the Open Graph
// card for a link, fetched by the server through the SSRF guard and cached.
// Any signed-in user may ask (viewers render cards too); 200 with only the URL
// filled in when the page was refused or could not be read.
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guard.js';
import { RateLimiter } from '../auth/rateLimit.js';
import { HttpError } from '../http.js';
import { getLinkPreview, normalizePreviewUrl } from '../embeds/linkPreviews.js';
import type { SafeFetchOptions } from '../embeds/safeFetch.js';

export interface LinkPreviewRouteOptions {
  fetchOptions?: SafeFetchOptions;
}

export async function linkPreviewRoutes(app: FastifyInstance, opts: LinkPreviewRouteOptions) {
  // Requests per user per minute, so the endpoint cannot be used as a crawler.
  const limiter = new RateLimiter(60, 60_000);

  app.get<{ Querystring: { url?: string } }>('/link-preview', async (req, reply) => {
    const user = requireUser(req);
    const url = normalizePreviewUrl(req.query.url);
    if (!limiter.take(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many link previews at once, try again in a minute');
    }
    const { preview } = await getLinkPreview(app.db, url, opts.fetchOptions);
    return reply.header('cache-control', 'private, max-age=300').send(preview);
  });
}
