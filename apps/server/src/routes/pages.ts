import type { FastifyInstance } from 'fastify';
import { movePageBody, savePageBody } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { deletePage, getPageView, movePage, requirePageRole, savePage } from '../pages/pages.js';

type IdParams = { Params: { id: string } };

export async function pageRoutes(app: FastifyInstance) {
  const db = app.db;
  const pageId = (raw: string) => uuidParam(raw, 'Page not found');

  app.get<IdParams>('/:id', async (req) => {
    return { page: await getPageView(db, requireUser(req), pageId(req.params.id)) };
  });

  app.put<IdParams>('/:id', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    await requirePageRole(db, user, id, 'editor');
    const body = parse(savePageBody, req.body);
    const { version } = await savePage(db, id, { title: body.title, doc: body.doc }, body.baseVersion, user.id);
    return { version };
  });

  app.post<IdParams>('/:id/move', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    const { space } = await requirePageRole(db, user, id, 'editor');
    const body = parse(movePageBody, req.body);
    await movePage(db, { pageId: id, spaceId: space.id, parentId: body.parentId, index: body.index });
    return { ok: true };
  });

  app.delete<IdParams>('/:id', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    await requirePageRole(db, user, id, 'editor');
    const deleted = await deletePage(db, id);
    return { ok: true, deleted };
  });
}
