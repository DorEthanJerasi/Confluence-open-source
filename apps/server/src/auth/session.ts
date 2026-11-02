// Server-side sessions (ARCHITECTURE.md §7). The browser holds an opaque
// random token in an httpOnly cookie; only its sha256 is stored.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Role, User } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_COOKIE = 'stillwater_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry is refreshed at most this often, to avoid a write per request. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function loadSession(db: Db, token: string): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const now = new Date();
  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now), isNull(users.disabledAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.sessionId));
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
}

export function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabledAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
