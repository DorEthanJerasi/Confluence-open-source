import type { FastifyInstance } from 'fastify';
import type { SearchResult } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parseLimit, parseQuery, searchPages } from '../search/search.js';

type SearchQuery = { Querystring: { q?: unknown; limit?: unknown } };

export async function searchRoutes(app: FastifyInstance) {
  app.get<SearchQuery>('/search', async (req): Promise<{ results: SearchResult[] }> => {
    const user = requireUser(req);
    const q = parseQuery(req.query.q);
    if (!q) return { results: [] };
    return { results: await searchPages(app.db, user, q, parseLimit(req.query.limit)) };
  });
}
