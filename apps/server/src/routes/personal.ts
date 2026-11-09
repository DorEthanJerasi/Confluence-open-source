// Favourites and recently viewed routes (done-check 09, 9a). Permission is
// decided in me/personal.ts through requirePageRole and visibleSpaceIds;
// signed out is 401 everywhere. Write bodies must be empty.
import type { FastifyInstance } from 'fastify';
import { emptyBody } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { listFavourites, listRecent, recordView, setFavourite } from '../me/personal.js';

type IdParams = { Params: { id: string } };

/** Under /api/pages: star a page, or record that it was opened. */
export async function pagePersonalRoutes(app: FastifyInstance) {
  const db = app.db;
  const pageId = (raw: string) => uuidParam(raw, 'Page not found');

  app.put<IdParams>('/:id/favourite', async (req, reply) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    parse(emptyBody, req.body);
    await setFavourite(db, user, id, true);
    return reply.status(204).send();
  });

  app.delete<IdParams>('/:id/favourite', async (req, reply) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    parse(emptyBody, req.body);
    await setFavourite(db, user, id, false);
    return reply.status(204).send();
  });

  app.post<IdParams>('/:id/viewed', async (req, reply) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    parse(emptyBody, req.body);
    await recordView(db, user, id);
    return reply.status(204).send();
  });
}

/** Under /api/me: the person's own lists. */
export async function meRoutes(app: FastifyInstance) {
  const db = app.db;
  app.get('/favourites', async (req) => ({ pages: await listFavourites(db, requireUser(req)) }));
  app.get('/recent', async (req) => ({ pages: await listRecent(db, requireUser(req)) }));
}
