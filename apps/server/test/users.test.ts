import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupApp, signup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

describe('user management', () => {
  it('only admins list users and set roles', async () => {
    const admin = await signup(ctx.app, 'Ada');
    const bo = await signup(ctx.app, 'Bo');

    expect((await bo.client.get('/api/users')).status).toBe(403);
    expect((await bo.client.patch(`/api/users/${bo.user.id}`, { role: 'admin' })).status).toBe(403);

    const list = await admin.client.get('/api/users');
    expect(list.body.users.map((u: { name: string }) => u.name)).toEqual(['Ada', 'Bo']);

    const res = await admin.client.patch(`/api/users/${bo.user.id}`, { role: 'viewer' });
    expect(res.body.user.role).toBe('viewer');
    expect((await bo.client.get('/api/auth/me')).body.user.role).toBe('viewer');
  });

  it('keeps at least one active admin', async () => {
    const admin = await signup(ctx.app, 'Ada');
    expect((await admin.client.patch(`/api/users/${admin.user.id}`, { role: 'editor' })).status).toBe(400);
    const bo = await signup(ctx.app, 'Bo');
    await admin.client.patch(`/api/users/${bo.user.id}`, { role: 'admin' });
    expect((await admin.client.patch(`/api/users/${admin.user.id}`, { role: 'editor' })).status).toBe(200);
  });

  it('lets anyone signed in read the directory, not anonymous visitors', async () => {
    const admin = await signup(ctx.app, 'Ada');
    expect((await admin.client.get('/api/users/directory')).body.users).toHaveLength(1);
    await admin.client.post('/api/auth/logout');
    expect((await admin.client.get('/api/users/directory')).status).toBe(401);
  });

  it('answers 404 for a malformed user id', async () => {
    const admin = await signup(ctx.app, 'Ada');
    expect((await admin.client.patch('/api/users/not-a-uuid', { role: 'viewer' })).status).toBe(404);
  });
});
