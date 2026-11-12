import type { FastifyInstance } from 'fastify';
import { movePageBody, restoreVersionBody, savePageBody, versionListQuery, type PageLockReply } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { HttpError, notFound, parse, uuidParam } from '../http.js';
import { getVersion, listVersions, restoreVersion } from '../pages/history.js';
import { getPageView, movePage, requirePageRole, savePage } from '../pages/pages.js';
import { lockPage, unlockPage } from '../pages/locks.js';
import { isTrashedForEditor, trashPage } from '../trash/trash.js';

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

  // A trashed page is 404 for everyone. Editors and up, who can open the
  // space's Trash view, get the code "in_trash" so the screen can say so.
  app.get<IdParams>('/:id', async (req) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    try {
      return { page: await getPageView(db, user, id) };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404 && (await isTrashedForEditor(db, user, id))) {
        throw new HttpError(404, 'in_trash', 'This page is in the trash');
      }
      throw err;
    }
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

  // ---- Page locks (done-check 17): editor and up; no-op when already in that state. ----

  app.post<IdParams>('/:id/lock', async (req): Promise<PageLockReply> => lockPage(db, requireUser(req), pageId(req.params.id)));

  app.post<IdParams>('/:id/unlock', async (req): Promise<PageLockReply> => unlockPage(db, requireUser(req), pageId(req.params.id)));

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
