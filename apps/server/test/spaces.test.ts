import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

async function team() {
  const admin = await signup(ctx.app, 'Ada');
  const ed = await signup(ctx.app, 'Bo');
  const viewer = await signup(ctx.app, 'Cy');
  await admin.client.patch(`/api/users/${viewer.user.id}`, { role: 'viewer' });
  return { admin, ed, viewer };
}

describe('spaces', () => {
  it('editors create spaces and become their admin; viewers cannot', async () => {
    const { ed, viewer } = await team();
    const res = await ed.client.post('/api/spaces', { key: 'Eng', name: 'Engineering' });
    expect(res.status).toBe(201);
    expect(res.body.space).toMatchObject({ key: 'eng', name: 'Engineering', visibility: 'open', myRole: 'admin' });

    expect((await viewer.client.post('/api/spaces', { key: 'mine', name: 'Mine' })).status).toBe(403);
    expect((await ed.client.post('/api/spaces', { key: 'eng', name: 'Again' })).status).toBe(409);
    expect((await ed.client.post('/api/spaces', { key: 'bad key!', name: 'X' })).status).toBe(400);
  });

  it('open spaces give everyone the default role; viewers stay read-only', async () => {
    const { admin, ed, viewer } = await team();
    await admin.client.post('/api/spaces', { key: 'hr', name: 'People', defaultRole: 'editor' });

    expect((await ed.client.get('/api/spaces/hr')).body.space.myRole).toBe('editor');
    expect((await viewer.client.get('/api/spaces/hr')).body.space.myRole).toBe('viewer');

    expect((await ed.client.post('/api/spaces/hr/pages', { title: 'Handbook' })).status).toBe(201);
    expect((await viewer.client.post('/api/spaces/hr/pages', { title: 'Nope' })).status).toBe(403);
  });

  it('a restricted space is invisible to non-members, in lists and by URL', async () => {
    const { admin, ed, viewer } = await team();
    await ed.client.post('/api/spaces', { key: 'secret', name: 'Secret', visibility: 'restricted' });
    const page = await ed.client.post('/api/spaces/secret/pages', { title: 'Plans' });
    const pageId = page.body.page.id;

    for (const outsider of [viewer]) {
      expect((await outsider.client.get('/api/spaces')).body.spaces).toEqual([]);
      expect((await outsider.client.get('/api/spaces/secret')).status).toBe(404);
      expect((await outsider.client.get('/api/spaces/secret/pages')).status).toBe(404);
      expect((await outsider.client.get(`/api/pages/${pageId}`)).status).toBe(404);
      expect((await outsider.client.put(`/api/pages/${pageId}`, { baseVersion: 1, title: 'x' })).status).toBe(404);
    }
    // Instance admins see everything.
    expect((await admin.client.get('/api/spaces')).body.spaces.map((s: { key: string }) => s.key)).toEqual(['secret']);

    // Adding the viewer as a member makes it visible, still read-only.
    expect((await ed.client.put(`/api/spaces/secret/members/${viewer.user.id}`, { role: 'editor' })).status).toBe(200);
    expect((await viewer.client.get('/api/spaces/secret')).body.space.myRole).toBe('viewer');
    expect((await viewer.client.get(`/api/pages/${pageId}`)).status).toBe(200);
    expect((await viewer.client.put(`/api/pages/${pageId}`, { baseVersion: 1, title: 'x' })).status).toBe(403);

    // Removing them hides it again.
    expect((await ed.client.del(`/api/spaces/secret/members/${viewer.user.id}`)).status).toBe(200);
    expect((await viewer.client.get('/api/spaces/secret')).status).toBe(404);
  });

  it('only space admins change settings and members, and the last admin stays', async () => {
    const { ed, viewer } = await team();
    const other = await signup(ctx.app, 'Di');
    await ed.client.post('/api/spaces', { key: 'ops', name: 'Ops' });
    await ed.client.put(`/api/spaces/ops/members/${other.user.id}`, { role: 'editor' });

    expect((await other.client.patch('/api/spaces/ops', { name: 'Mine now' })).status).toBe(403);
    expect((await other.client.put(`/api/spaces/ops/members/${viewer.user.id}`, { role: 'editor' })).status).toBe(403);
    expect((await ed.client.patch('/api/spaces/ops', { name: 'Operations', visibility: 'restricted' })).body.space)
      .toMatchObject({ name: 'Operations', visibility: 'restricted' });

    expect((await ed.client.put(`/api/spaces/ops/members/${ed.user.id}`, { role: 'editor' })).status).toBe(400);
    expect((await ed.client.del(`/api/spaces/ops/members/${ed.user.id}`)).status).toBe(400);

    const members = await ed.client.get('/api/spaces/ops/members');
    expect(members.body.members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual([
      'Bo:admin',
      'Di:editor',
    ]);
  });

  it('deleting a space removes its pages', async () => {
    const { ed } = await team();
    await ed.client.post('/api/spaces', { key: 'tmp', name: 'Temp' });
    const page = await ed.client.post('/api/spaces/tmp/pages', { title: 'Gone soon' });
    expect((await ed.client.del('/api/spaces/tmp')).status).toBe(200);
    expect((await ed.client.get(`/api/pages/${page.body.page.id}`)).status).toBe(404);
    expect((await ed.client.get('/api/spaces/tmp')).status).toBe(404);
  });

  it('requires a session for everything', async () => {
    await team();
    const anon = new Client(ctx.app);
    expect((await anon.get('/api/spaces')).status).toBe(401);
    expect((await anon.post('/api/spaces', { key: 'x1', name: 'X' })).status).toBe(401);
  });
});
