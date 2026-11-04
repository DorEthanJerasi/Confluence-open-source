import type { FastifyInstance } from 'fastify';
import { aiStatusReply, type AiStatus } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';

export async function aiRoutes(app: FastifyInstance) {
  // Only "is AI on". No provider name, no model, never the key.
  app.get('/status', async (req): Promise<AiStatus> => {
    requireUser(req);
    return aiStatusReply.parse({ enabled: app.ai !== null });
  });
}
