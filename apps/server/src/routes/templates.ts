// Page template routes (done-check 08, 8a). Permission is decided in
// templates/templates.ts through requireSpaceByKey; signed out is 401 everywhere.
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guard.js';
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from '../templates/templates.js';

type KeyParams = { Params: { key: string } };
type TemplateParams = { Params: { key: string; id: string } };

/** Under /api/spaces. */
export async function templateRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get<KeyParams>('/:key/templates', async (req) => {
    return { templates: await listTemplates(db, requireUser(req), req.params.key) };
  });

  app.get<TemplateParams>('/:key/templates/:id', async (req) => {
    return { template: await getTemplate(db, requireUser(req), req.params.key, req.params.id) };
  });

  app.post<KeyParams>('/:key/templates', async (req, reply) => {
    const user = requireUser(req);
    const template = await createTemplate(db, user, req.params.key, req.body);
    return reply.status(201).send({ template });
  });

  app.patch<TemplateParams>('/:key/templates/:id', async (req) => {
    const user = requireUser(req);
    return { template: await updateTemplate(db, user, req.params.key, req.params.id, req.body) };
  });

  app.delete<TemplateParams>('/:key/templates/:id', async (req, reply) => {
    const user = requireUser(req);
    await deleteTemplate(db, user, req.params.key, req.params.id);
    return reply.status(204).send();
  });
}
