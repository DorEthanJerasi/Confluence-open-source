// Follow and notification routes (docs/done-checks/15-mentions.md, 15a).
// Signed out: 401 on every route (requireUser). The logic and the permission
// checks are in notifications/notifications.ts: follow routes go through
// requirePageRole (404 for a page the person cannot read), notification routes
// only ever touch the signed-in person's own rows.
import type { FastifyInstance } from 'fastify';
import {
  emptyBody,
  markReadBody,
  notificationsQuery,
  type FollowReply,
  type NotificationList,
  type UnreadCount,
} from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { listNotifications, markRead, setFollow, unreadCount } from '../notifications/notifications.js';

type IdParams = { Params: { id: string } };

/** Under /api/pages: follow and unfollow a page. */
export async function pageFollowRoutes(app: FastifyInstance) {
  const db = app.db;
  const pageId = (raw: string) => uuidParam(raw, 'Page not found');

  app.put<IdParams>('/:id/follow', async (req): Promise<FollowReply> => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    parse(emptyBody, req.body);
    return setFollow(db, user, id, true);
  });

  app.delete<IdParams>('/:id/follow', async (req): Promise<FollowReply> => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    parse(emptyBody, req.body);
    return setFollow(db, user, id, false);
  });
}

/** Under /api/me/notifications: the signed-in person's own notifications. */
export async function notificationRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req): Promise<NotificationList> => {
    const user = requireUser(req);
    const { before } = parse(notificationsQuery, req.query);
    return listNotifications(db, user, before);
  });

  app.get('/unread', async (req): Promise<UnreadCount> => ({ count: await unreadCount(db, requireUser(req)) }));

  app.post('/read', async (req): Promise<UnreadCount> => {
    const user = requireUser(req);
    const body = parse(markReadBody, req.body);
    return { count: await markRead(db, user, body) };
  });
}
