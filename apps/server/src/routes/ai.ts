import type { FastifyInstance } from 'fastify';
import { aiStatusReply, askBody, askReply, pageSummaryReply, type AiStatus, type AskReply, type PageSummary } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { askDocs, summarisePage } from '../ai/features.js';
import { aiOff } from '../ai/provider.js';

export async function aiRoutes(app: FastifyInstance) {
  // Only "is AI on". No provider name, no model, never the key.
  app.get('/status', async (req): Promise<AiStatus> => {
    requireUser(req);
    return aiStatusReply.parse({ enabled: app.ai !== null });
  });

  // Ask your docs: answers only from pages the asker can read, with the
  // server's own list of cited sources.
  app.post('/ask', async (req): Promise<AskReply> => {
    if (!app.ai) throw aiOff();
    const user = requireUser(req);
    const { question } = parse(askBody, req.body);
    return askReply.parse(await askDocs(app.db, app.ai, user, question));
  });
}

/** AI routes that live under a page (registered with the /api/pages prefix). */
export async function aiPageRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/:id/summary', async (req): Promise<PageSummary> => {
    // Off means the route does not exist, for everyone.
    if (!app.ai) throw aiOff();
    const user = requireUser(req);
    const id = uuidParam(req.params.id, 'Page not found');
    return pageSummaryReply.parse({ summary: await summarisePage(app.db, app.ai, user, id) });
  });
}
