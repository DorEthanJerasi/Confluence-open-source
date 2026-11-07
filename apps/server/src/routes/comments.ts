// Comment routes (done-check 07, 7a). Permission is decided in
// comments/comments.ts through requirePageRole; signed out is 401 everywhere.
import type { FastifyInstance } from 'fastify';
import { createCommentBody, editCommentBody } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { createComment, deleteComment, editComment, listComments, setResolved } from '../comments/comments.js';

type IdParams = { Params: { id: string } };

/** Under /api/pages: the comments of one page. */
export async function pageCommentRoutes(app: FastifyInstance) {
  const db = app.db;
  const pageId = (raw: string) => uuidParam(raw, 'Page not found');

  app.get<IdParams>('/:id/comments', async (req) => {
    return listComments(db, requireUser(req), pageId(req.params.id));
  });

  app.post<IdParams>('/:id/comments', async (req, reply) => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    const body = parse(createCommentBody, req.body);
    const comment = await createComment(db, user, id, body);
    return reply.status(201).send({ comment });
  });
}

/** Under /api/comments: one comment, found by its id. */
export async function commentRoutes(app: FastifyInstance) {
  const db = app.db;
  const commentId = (raw: string) => uuidParam(raw, 'Comment not found');

  app.patch<IdParams>('/:id', async (req) => {
    const user = requireUser(req);
    const id = commentId(req.params.id);
    const { body } = parse(editCommentBody, req.body);
    return { comment: await editComment(db, user, id, body) };
  });

  app.delete<IdParams>('/:id', async (req, reply) => {
    const user = requireUser(req);
    await deleteComment(db, user, commentId(req.params.id));
    return reply.status(204).send();
  });

  app.post<IdParams>('/:id/resolve', async (req) => {
    const user = requireUser(req);
    return { comment: await setResolved(db, user, commentId(req.params.id), true) };
  });

  app.post<IdParams>('/:id/reopen', async (req) => {
    const user = requireUser(req);
    return { comment: await setResolved(db, user, commentId(req.params.id), false) };
  });
}
