import type { FastifyInstance } from 'fastify';
import { movePageBody, restoreVersionBody, savePageBody, versionListQuery } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { notFound, parse, uuidParam } from '../http.js';
import { getVersion, listVersions, restoreVersion } from '../pages/history.js';
import { getPageView, movePage, requirePageRole, savePage } from '../pages/pages.js';
import { trashPage } from '../trash/trash.js';

type IdParams = { Params: { id: string } };
type VersionParams = { Params: { id: string; version: string } };

/** A version number in the URL; anything that is not a positive whole number names no snapshot. */
function versionParam(raw: string): number {
  const n = /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n > 2147483647) throw notFound('Version not found');
  return n;
}

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

  // Moves the page and its sub-pages to the trash (done-check 11).
  app.delete<IdParams>('/:id', async (req) => {
    const deleted = await trashPage(db, requireUser(req), pageId(req.params.id));
    return { ok: true, deleted };
  });

  // ---- Page history (done-check 03, 3b). Every route goes through requirePageRole. ----

  app.get<IdParams>('/:id/versions', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    await requirePageRole(db, user, id, 'viewer');
    const { before } = parse(versionListQuery, req.query);
    return listVersions(db, id, before);
  });

  app.get<VersionParams>('/:id/versions/:version', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    await requirePageRole(db, user, id, 'viewer');
    return getVersion(db, id, versionParam(req.params.version));
  });

  app.post<VersionParams>('/:id/versions/:version/restore', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    await requirePageRole(db, user, id, 'editor');
    const version = versionParam(req.params.version);
    const { baseVersion } = parse(restoreVersionBody, req.body);
    return restoreVersion(db, id, version, baseVersion, user.id);
  });
}
