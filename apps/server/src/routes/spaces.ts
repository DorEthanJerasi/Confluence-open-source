import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  createPageBody,
  createSpaceBody,
  setMemberBody,
  updateSpaceBody,
  type PageTreeItem,
  type Role,
  type Space,
  type SpaceMember,
} from '@stillwater/shared';
import { pages, spaceMembers, spaces, users } from '../db/schema.js';
import { effectiveRole, requireSpaceByKey, visibleSpaceIds, type SpaceRow } from '../auth/permissions.js';
import { requireInstanceRole, requireUser } from '../auth/guard.js';
import { badRequest, conflict, notFound, parse, uuidParam } from '../http.js';
import { byPosition, createPage, getPageView } from '../pages/pages.js';
import { pageDocFromTemplate } from '../templates/templates.js';

export function toSpace(row: SpaceRow, myRole: Role): Space {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    defaultRole: row.defaultRole,
    createdAt: row.createdAt.toISOString(),
    myRole,
  };
}

type KeyParams = { Params: { key: string } };
type MemberParams = { Params: { key: string; userId: string } };

export async function spaceRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({ space: spaces, memberRole: spaceMembers.role })
      .from(spaces)
      .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, user.id)))
      .where(sql`${spaces.id} in (${visibleSpaceIds(user)})`)
      .orderBy(asc(spaces.name));
    const list: Space[] = [];
    for (const r of rows) {
      const role = effectiveRole(user, r.space, r.memberRole ?? null);
      if (role) list.push(toSpace(r.space, role));
    }
    return { spaces: list };
  });

  app.post('/', async (req, reply) => {
    const user = requireInstanceRole(req, 'editor');
    const body = parse(createSpaceBody, req.body);
    const created = await db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.key, body.key));
      if (taken) throw conflict('key_taken', 'A space with that key already exists');
      const [row] = await tx
        .insert(spaces)
        .values({ ...body, createdBy: user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw conflict('key_taken', 'A space with that key already exists');
      await tx.insert(spaceMembers).values({ spaceId: row.id, userId: user.id, role: 'admin' });
      return row;
    });
    return reply.status(201).send({ space: toSpace(created, 'admin') });
  });

  app.get<KeyParams>('/:key', async (req) => {
    const { space, role } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'viewer');
    return { space: toSpace(space, role) };
  });

  app.patch<KeyParams>('/:key', async (req) => {
    const { space, role } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'admin');
    const body = parse(updateSpaceBody, req.body);
    const [row] = await db.update(spaces).set(body).where(eq(spaces.id, space.id)).returning();
    return { space: toSpace(row!, role) };
  });

  app.delete<KeyParams>('/:key', async (req) => {
    const { space } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'admin');
    await db.delete(spaces).where(eq(spaces.id, space.id));
    return { ok: true };
  });

  // ---- Members ----

  app.get<KeyParams>('/:key/members', async (req) => {
    const { space } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'viewer');
    const rows = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: spaceMembers.role })
      .from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(eq(spaceMembers.spaceId, space.id))
      .orderBy(asc(users.name));
    return { members: rows satisfies SpaceMember[] };
  });

  async function ensureAnotherAdmin(spaceId: string, userId: string) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.role, 'admin'), sql`${spaceMembers.userId} <> ${userId}`));
    if ((row?.n ?? 0) === 0) throw badRequest('A space needs at least one admin member');
  }

  app.put<MemberParams>('/:key/members/:userId', async (req) => {
    const { space } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'admin');
    const userId = uuidParam(req.params.userId, 'User not found');
    const { role } = parse(setMemberBody, req.body);
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.disabledAt)));
    if (!target) throw notFound('User not found');
    const [current] = await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
    if (current?.role === 'admin' && role !== 'admin') await ensureAnotherAdmin(space.id, userId);
    await db
      .insert(spaceMembers)
      .values({ spaceId: space.id, userId, role })
      .onConflictDoUpdate({ target: [spaceMembers.spaceId, spaceMembers.userId], set: { role } });
    return { ok: true };
  });

  app.delete<MemberParams>('/:key/members/:userId', async (req) => {
    const { space } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'admin');
    const userId = uuidParam(req.params.userId, 'User not found');
    const [current] = await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
    if (!current) throw notFound('Not a member');
    if (current.role === 'admin') await ensureAnotherAdmin(space.id, userId);
    await db.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
    return { ok: true };
  });

  // ---- Pages in a space ----

  app.get<KeyParams>('/:key/pages', async (req) => {
    const { space } = await requireSpaceByKey(db, requireUser(req), req.params.key, 'viewer');
    const rows = await db
      .select({ id: pages.id, parentId: pages.parentId, title: pages.title, position: pages.position })
      .from(pages)
      .where(and(eq(pages.spaceId, space.id), isNull(pages.deletedAt)))
      .orderBy(byPosition, asc(pages.id));
    return { pages: rows satisfies PageTreeItem[] };
  });

  app.post<KeyParams>('/:key/pages', async (req, reply) => {
    const user = requireUser(req);
    const { space } = await requireSpaceByKey(db, user, req.params.key, 'editor');
    const { templateId, ...body } = parse(createPageBody, req.body);
    // From a template: the page starts as a copy of it, with fresh block ids (done-check 08).
    const doc = templateId !== undefined ? await pageDocFromTemplate(db, space, templateId) : body.doc;
    const id = await createPage(db, { spaceId: space.id, userId: user.id, ...body, doc });
    return reply.status(201).send({ page: await getPageView(db, user, id) });
  });
}
