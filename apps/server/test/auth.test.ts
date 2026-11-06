import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

describe('sign up and log in', () => {
  it('makes the first account admin and later ones editors', async () => {
    const config0 = await new Client(ctx.app).get('/api/auth/config');
    expect(config0.body).toEqual({ allowSignup: true, hasUsers: false });

    const a = await signup(ctx.app, 'Ada');
    const b = await signup(ctx.app, 'Bo');
    const c = await signup(ctx.app, 'Cy');
    expect([a.user.role, b.user.role, c.user.role]).toEqual(['admin', 'editor', 'editor']);

    const me = await b.client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('bo@example.com');
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('refuses a duplicate email, case-insensitively', async () => {
    await signup(ctx.app, 'Ada', 'ada@example.com');
    const res = await new Client(ctx.app).post('/api/auth/signup', {
      email: 'ADA@Example.com',
      name: 'Other',
      password: 'another password',
    });
    expect(res.status).toBe(409);
  });

  it('rejects short passwords and bad emails', async () => {
    const c = new Client(ctx.app);
    expect((await c.post('/api/auth/signup', { email: 'x@example.com', name: 'X', password: 'short' })).status).toBe(400);
    expect((await c.post('/api/auth/signup', { email: 'nope', name: 'X', password: 'long enough' })).status).toBe(400);
  });

  it('logs in with the right password only, and the session persists until logout', async () => {
    await signup(ctx.app, 'Ada');
    const c = new Client(ctx.app);
    expect((await c.post('/api/auth/login', { email: 'ada@example.com', password: 'wrong password' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever1' })).status).toBe(401);
    const ok = await c.post('/api/auth/login', { email: 'Ada@example.com', password: 'correct horse battery' });
    expect(ok.status).toBe(200);

    // A "reload" is just another request with the same cookie.
    const cookie = c.cookie;
    const again = new Client(ctx.app);
    again.cookie = cookie;
    expect((await again.get('/api/auth/me')).status).toBe(200);

    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await again.get('/api/auth/me')).status).toBe(401);
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const res = await new Client(ctx.app).post('/api/auth/signup', {
      email: 'ada@example.com',
      name: 'Ada',
      password: 'correct horse battery',
    });
    const cookie = res.raw.cookies.find((c) => c.name === 'stillwater_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
  });

  it('refuses cross-site writes', async () => {
    const res = await new Client(ctx.app).req(
      'POST',
      '/api/auth/signup',
      { email: 'ada@example.com', name: 'Ada', password: 'correct horse battery' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    const same = await new Client(ctx.app).req(
      'POST',
      '/api/auth/signup',
      { email: 'ada@example.com', name: 'Ada', password: 'correct horse battery' },
      { origin: 'http://wiki.test' },
    );
    expect(same.status).toBe(201);
  });

  it('rate-limits repeated failed logins for one email', async () => {
    await signup(ctx.app, 'Ada');
    const c = new Client(ctx.app);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await c.post('/api/auth/login', { email: 'ada@example.com', password: `wrong-${i}-pass` })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('a disabled user cannot log in and loses their sessions', async () => {
    const admin = await signup(ctx.app, 'Ada');
    const bo = await signup(ctx.app, 'Bo');
    expect((await admin.client.patch(`/api/users/${bo.user.id}`, { disabled: true })).status).toBe(200);
    expect((await bo.client.get('/api/auth/me')).status).toBe(401);
    const login = await new Client(ctx.app).post('/api/auth/login', { email: 'bo@example.com', password: 'correct horse battery' });
    expect(login.status).toBe(401);
  });
});

describe('closed sign-up', () => {
  let closed: TestCtx;
  beforeAll(async () => {
    closed = await setupApp({ ALLOW_SIGNUP: 'false' });
  });
  afterAll(() => closed.close());

  it('still lets the first admin in, then only admins create accounts', async () => {
    await closed.reset();
    const admin = await signup(closed.app, 'Ada');
    expect(admin.user.role).toBe('admin');
    const res = await new Client(closed.app).post('/api/auth/signup', {
      email: 'bo@example.com',
      name: 'Bo',
      password: 'correct horse battery',
    });
    expect(res.status).toBe(403);
    const created = await admin.client.post('/api/users', {
      email: 'bo@example.com',
      name: 'Bo',
      password: 'correct horse battery',
      role: 'viewer',
    });
    expect(created.status).toBe(201);
    const login = await new Client(closed.app).post('/api/auth/login', { email: 'bo@example.com', password: 'correct horse battery' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('viewer');
  });
});

// Own server, so the in-memory login limiter starts empty and the
// failures below cannot spill into the other tests.
describe('login rate limit per address', () => {
  let limited: TestCtx;
  beforeAll(async () => {
    limited = await setupApp();
    await limited.reset();
  });
  afterAll(() => limited.close());

  it('does not lock out a team logging in from one address: good logins do not count', async () => {
    // Every request here comes from the same address, like an office behind one public IP.
    const people = ['Ada', 'Bo', 'Cy', 'Di'];
    for (const p of people) await signup(limited.app, p);
    for (let round = 0; round < 10; round++) {
      for (const p of people) {
        const res = await new Client(limited.app).post('/api/auth/login', {
          email: `${p.toLowerCase()}@example.com`,
          password: 'correct horse battery',
        });
        expect(res.status).toBe(200);
      }
    }
  });

  it('still rate-limits many failed logins from one address, across different emails', async () => {
    const c = new Client(limited.app);
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      statuses.push((await c.post('/api/auth/login', { email: `guess${i}@example.com`, password: 'wrong password' })).status);
    }
    expect(statuses[0]).toBe(401);
    expect(statuses.at(-1)).toBe(429);
  });
});
