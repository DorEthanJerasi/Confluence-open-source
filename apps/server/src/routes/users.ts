import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { createUserBody, updateUserBody } from '@stillwater/shared';
import { users } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { deleteUserSessions, toUser } from '../auth/session.js';
import { requireInstanceRole, requireUser } from '../auth/guard.js';
import { badRequest, conflict, notFound, parse, uuidParam } from '../http.js';

export async function userRoutes(app: FastifyInstance) {
  const db = app.db;

  // Admin: everyone, with roles and status.
  app.get('/', async (req) => {
    requireInstanceRole(req, 'admin');
    const rows = await db.select().from(users).orderBy(asc(users.name));
    return { users: rows.map(toUser) };
  });

  // Anyone signed in: active people, for picking space members.
  app.get('/directory', async (req) => {
    requireUser(req);
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(isNull(users.disabledAt))
      .orderBy(asc(users.name));
    return { users: rows };
  });

  app.post('/', async (req, reply) => {
    requireInstanceRole(req, 'admin');
    const body = parse(createUserBody, req.body);
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (taken) throw conflict('email_taken', 'An account with that email already exists');
    const [row] = await db
      .insert(users)
      .values({ email: body.email, name: body.name, role: body.role, passwordHash: await hashPassword(body.password) })
      .returning();
    return reply.status(201).send({ user: toUser(row!) });
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const me = requireInstanceRole(req, 'admin');
    const id = uuidParam(req.params.id, 'User not found');
    const body = parse(updateUserBody, req.body);
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) throw notFound('User not found');

    const losesAdmin =
      target.role === 'admin' && !target.disabledAt && ((body.role && body.role !== 'admin') || body.disabled === true);
    if (losesAdmin) {
      const [others] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, 'admin'), isNull(users.disabledAt), ne(users.id, id)));
      if ((others?.n ?? 0) === 0) throw badRequest('There must always be at least one active admin');
    }
    if (body.disabled === true && id === me.id) throw badRequest('You cannot disable your own account');

    const [row] = await db
      .update(users)
      .set({
        ...(body.role ? { role: body.role } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null } : {}),
      })
      .where(eq(users.id, id))
      .returning();
    if (body.disabled === true) await deleteUserSessions(db, id);
    return { user: toUser(row!) };
  });
}
