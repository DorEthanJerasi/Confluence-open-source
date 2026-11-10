// Trash routes (docs/done-checks/11-trash.md, 11a). Registered under /api.
// Signed out: 401 on every route (requireUser). Permission and the logic are
// in trash/trash.ts, through the one permission path.
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guard.js';
import { uuidParam } from '../http.js';
import {
  emptyTrash,
  listTrash,
  listTrashedSpaces,
  purgePage,
  purgeSpace,
  restorePage,
  restoreSpace,
  trashSpace,
} from '../trash/trash.js';

type KeyParams = { Params: { key: string } };
type IdParams = { Params: { id: string } };

export async function trashRoutes(app: FastifyInstance) {
  const { db, storage, config } = app;
  const days = config.trashRetentionDays;
  const pageId = (raw: string) => uuidParam(raw, 'Page not found');
  const spaceId = (raw: string) => uuidParam(raw, 'Space not found');

  app.get<KeyParams>('/spaces/:key/trash', async (req) => listTrash(db, requireUser(req), req.params.key, days));

  app.delete<KeyParams>('/spaces/:key/trash', async (req) => ({
    purged: await emptyTrash(db, storage, requireUser(req), req.params.key),
  }));

  app.delete<KeyParams>('/spaces/:key', async (req, reply) => {
    await trashSpace(db, requireUser(req), req.params.key);
    return reply.status(204).send();
  });

  app.post<IdParams>('/pages/:id/restore', async (req) => {
    const user = requireUser(req);
    return restorePage(db, user, pageId(req.params.id));
  });

  app.delete<IdParams>('/pages/:id/purge', async (req, reply) => {
    const user = requireUser(req);
    await purgePage(db, storage, user, pageId(req.params.id));
    return reply.status(204).send();
  });

  app.get('/trash/spaces', async (req) => listTrashedSpaces(db, requireUser(req), days));

  app.post<IdParams>('/trash/spaces/:id/restore', async (req) => {
    const user = requireUser(req);
    return restoreSpace(db, user, spaceId(req.params.id));
  });

  app.delete<IdParams>('/trash/spaces/:id', async (req, reply) => {
    const user = requireUser(req);
    await purgeSpace(db, storage, user, spaceId(req.params.id));
    return reply.status(204).send();
  });
}
