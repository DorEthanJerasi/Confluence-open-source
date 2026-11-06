import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { loginBody, signupBody, type AuthConfig } from '@stillwater/shared';
import { users } from '../db/schema.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../auth/password.js';
import { RateLimiter } from '../auth/rateLimit.js';
import {
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  toUser,
} from '../auth/session.js';
import { conflict, HttpError, parse, unauthorized } from '../http.js';
import { requireUser } from '../auth/guard.js';

const WINDOW = 15 * 60 * 1000;

function setSessionCookie(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: app.config.secureCookies || req.protocol === 'https',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;
  const perIp = new RateLimiter(30, WINDOW);
  const perEmail = new RateLimiter(10, WINDOW);
  const signupPerIp = new RateLimiter(20, WINDOW);

  const tooMany = () => new HttpError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');

  app.get('/config', async (): Promise<AuthConfig> => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    return { allowSignup: app.config.allowSignup, hasUsers: (row?.n ?? 0) > 0 };
  });

  app.get('/me', async (req) => {
    const me = requireUser(req);
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    if (!row) throw unauthorized();
    return { user: toUser(row) };
  });

  app.post('/signup', async (req, reply) => {
    if (!signupPerIp.take(req.ip)) throw tooMany();
    const body = parse(signupBody, req.body);
    const passwordHash = await hashPassword(body.password);

    const user = await db.transaction(async (tx) => {
      // Serialise sign-ups so exactly one account becomes the first admin.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stillwater:signup'))`);
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
      const first = (count?.n ?? 0) === 0;
      if (!first && !app.config.allowSignup) {
        throw new HttpError(403, 'signup_closed', 'Sign-up is closed. Ask an admin to create your account.');
      }
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email));
      if (taken) throw conflict('email_taken', 'An account with that email already exists');
      const [created] = await tx
        .insert(users)
        .values({ email: body.email, name: body.name, passwordHash, role: first ? 'admin' : 'editor' })
        .returning();
      return created!;
    });

    setSessionCookie(app, req, reply, await createSession(db, user.id));
    return reply.status(201).send({ user: toUser(user) });
  });

  app.post('/login', async (req, reply) => {
    const body = parse(loginBody, req.body);
    if (!perIp.take(req.ip) || !perEmail.take(body.email)) throw tooMany();

    const [row] = await db.select().from(users).where(eq(users.email, body.email));
    if (!row) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, 'bad_credentials', 'That email and password do not match');
    }
    const ok = await verifyPassword(row.passwordHash, body.password);
    if (!ok || row.disabledAt) {
      throw new HttpError(401, 'bad_credentials', 'That email and password do not match');
    }
    // Only failed attempts count. A whole team behind one office address
    // must be able to log in, so a good login gives its per-IP slot back.
    perIp.refund(req.ip);
    perEmail.reset(body.email);
    setSessionCookie(app, req, reply, await createSession(db, row.id));
    return { user: toUser(row) };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
