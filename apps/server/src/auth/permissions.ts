// The one place a user's role in a space is decided (ARCHITECTURE.md §7).
// Every route goes through requireSpaceRole / requireSpaceByKey, and every
// list (spaces, search, AI retrieval, downloads) filters with visibleSpaceIds,
// so there is no second permission path to drift.
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { minRole, roleAtLeast, type Role, type Visibility } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { spaceMembers, spaces } from '../db/schema.js';
import { forbidden, notFound } from '../http.js';
import type { SessionUser } from './session.js';

export interface SpaceAccessInfo {
  visibility: Visibility;
  defaultRole: Role;
}

/** Pure rule: instance role + membership + space settings -> role in the space (null = no access). */
export function effectiveRole(
  user: Pick<SessionUser, 'role'>,
  space: SpaceAccessInfo,
  membershipRole: Role | null,
): Role | null {
  if (user.role === 'admin') return 'admin';
  const base = membershipRole ?? (space.visibility === 'open' ? space.defaultRole : null);
  if (!base) return null;
  return user.role === 'viewer' ? minRole(base, 'viewer') : base;
}

/**
 * SQL subquery of the ids of every space the user can at least read.
 * Use as `inArray(x.spaceId, visibleSpaceIds(user))` or `x.space_id in (${visibleSpaceIds(user)})`.
 * Must agree with effectiveRole: anyone with a role can read.
 */
export function visibleSpaceIds(user: Pick<SessionUser, 'id' | 'role'>): SQL {
  if (user.role === 'admin') return sql`select ${spaces.id} from ${spaces}`;
  return sql`select ${spaces.id} from ${spaces} where ${spaces.visibility} = 'open' or exists (select 1 from ${spaceMembers} where ${spaceMembers.spaceId} = ${spaces.id} and ${spaceMembers.userId} = ${user.id})`;
}

export type SpaceRow = typeof spaces.$inferSelect;

async function loadWithRole(
  db: Db,
  user: SessionUser,
  where: SQL,
): Promise<{ space: SpaceRow; role: Role | null } | null> {
  const rows = await db
    .select({ space: spaces, memberRole: spaceMembers.role })
    .from(spaces)
    .leftJoin(spaceMembers, and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, user.id)))
    .where(where)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { space: row.space, role: effectiveRole(user, row.space, row.memberRole ?? null) };
}

function check(found: { space: SpaceRow; role: Role | null } | null, needed: Role) {
  // A space the user cannot read does not exist for them: 404, never 403.
  if (!found || !found.role) throw notFound('Space not found');
  if (!roleAtLeast(found.role, needed)) throw forbidden();
  return { space: found.space, role: found.role };
}

export async function requireSpaceRole(db: Db, user: SessionUser, spaceId: string, needed: Role) {
  return check(await loadWithRole(db, user, eq(spaces.id, spaceId)), needed);
}

export async function requireSpaceByKey(db: Db, user: SessionUser, key: string, needed: Role) {
  return check(await loadWithRole(db, user, eq(spaces.key, key.toLowerCase())), needed);
}
