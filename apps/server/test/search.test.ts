// Stage 3a: GET /api/search against real Postgres (docs/done-checks/03-search-history.md).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HIT_END, HIT_START, splitSnippet } from '@stillwater/shared';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

// A fresh app per test: each test signs up several people, and sign-ups are
// rate limited per app (20 per address), so one shared app would run out.
let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setupApp();
  await ctx.reset();
});
afterEach(() => ctx.close());

const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

type Result = { pageId: string; title: string; spaceKey: string; spaceName: string; snippet: string; breadcrumbs: { id: string; title: string }[] };

async function search(c: Client, q: string, extra = '') {
  const res = await c.get(`/api/search?q=${encodeURIComponent(q)}${extra}`);
  return { status: res.status, results: (res.body?.results ?? []) as Result[] };
}
const titles = (rs: Result[]) => rs.map((r) => r.title);
const plain = (s: string) => s.replaceAll(HIT_START, '').replaceAll(HIT_END, '');

/** First user is the instance admin; Bea is an ordinary editor. */
async function team() {
  const admin = await signup(ctx.app, 'Ada');
  const bea = await signup(ctx.app, 'Bea');
  const page = async (c: Client, space: string, title: string, body?: string, parentId: string | null = null) => {
    const res = await c.post(`/api/spaces/${space}/pages`, { title, parentId });
    expect(res.status).toBe(201);
    const id = res.body.page.id as string;
    if (body !== undefined) {
      expect((await c.put(`/api/pages/${id}`, { baseVersion: 1, doc: para(body) })).status).toBe(200);
    }
    return id;
  };
  return { admin, bea, page };
}

describe('GET /api/search', () => {
  it('finds a body word right after one save, and a title-only word', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    const id = await page(bea.client, 'eng', 'Runbook');
    expect((await search(bea.client, 'quokka')).results).toEqual([]);
    expect((await bea.client.put(`/api/pages/${id}`, { baseVersion: 1, doc: para('Feed the quokka at noon.') })).status).toBe(200);

    const body = await search(bea.client, 'quokka');
    expect(body.status).toBe(200);
    expect(body.results).toHaveLength(1);
    const [hit] = body.results;
    expect(hit).toMatchObject({ pageId: id, title: 'Runbook', spaceKey: 'eng', spaceName: 'Engineering', breadcrumbs: [] });
    expect(hit!.snippet).toContain(`${HIT_START}quokka${HIT_END}`);
    expect(splitSnippet(hit!.snippet)).toContainEqual({ text: 'quokka', hit: true });

    const title = await search(bea.client, 'runbook');
    expect(titles(title.results)).toEqual(['Runbook']);
    expect(title.results[0]!.snippet).toBe(`${HIT_START}Runbook${HIT_END}`);
  });

  it('ranks a title match above a body-only match and returns breadcrumbs', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    const parent = await page(bea.client, 'eng', 'Guides');
    await page(bea.client, 'eng', 'Notes', 'Something about the walrus here.', parent);
    await page(bea.client, 'eng', 'Walrus', 'Plain words only.');
    const { results } = await search(bea.client, 'walrus');
    expect(titles(results)).toEqual(['Walrus', 'Notes']);
    expect(results[1]!.breadcrumbs).toEqual([{ id: parent, title: 'Guides' }]);
  });

  it('never shows a restricted space to a non-member, and follows membership changes', async () => {
    const { admin, bea, page } = await team();
    const cy = await signup(ctx.app, 'Cy');
    await bea.client.post('/api/spaces', { key: 'hr', name: 'People', visibility: 'restricted' });
    await page(bea.client, 'hr', 'Salary bands', 'Secret pay table.');

    expect(titles((await search(bea.client, 'salary bands')).results)).toEqual(['Salary bands']);
    expect((await search(cy.client, 'Salary bands')).results).toEqual([]);
    expect((await search(cy.client, 'secret')).results).toEqual([]);
    expect((await search(cy.client, 'sala')).results).toEqual([]);

    expect((await bea.client.put(`/api/spaces/hr/members/${cy.user.id}`, { role: 'viewer' })).status).toBe(200);
    expect(titles((await search(cy.client, 'Salary bands')).results)).toEqual(['Salary bands']);

    expect((await bea.client.del(`/api/spaces/hr/members/${cy.user.id}`)).status).toBe(200);
    expect((await search(cy.client, 'Salary bands')).results).toEqual([]);

    // An instance admin finds it without being a member.
    expect(titles((await search(admin.client, 'Salary bands')).results)).toEqual(['Salary bands']);
  });

  it('shows an open space to every signed-in user, including an instance viewer', async () => {
    const { admin, bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'wiki', name: 'Wiki' });
    await page(bea.client, 'wiki', 'Lunch menu', 'Tuesday is pancake day.');
    const made = await admin.client.post('/api/users', { email: 'vi@example.com', name: 'Vi', password: 'correct horse battery', role: 'viewer' });
    expect(made.status).toBe(201);
    const vi = new Client(ctx.app);
    expect((await vi.post('/api/auth/login', { email: 'vi@example.com', password: 'correct horse battery' })).status).toBe(200);
    const cy = await signup(ctx.app, 'Cy');

    for (const c of [vi, cy.client, admin.client, bea.client]) {
      expect(titles((await search(c, 'pancake')).results)).toEqual(['Lunch menu']);
    }
  });

  it('lets an instance admin find pages in every space', async () => {
    const { admin, bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'open', name: 'Open' });
    await bea.client.post('/api/spaces', { key: 'shut', name: 'Shut', visibility: 'restricted' });
    await page(bea.client, 'open', 'Heron open');
    await page(bea.client, 'shut', 'Heron shut');
    const { results } = await search(admin.client, 'heron');
    expect(titles(results).sort()).toEqual(['Heron open', 'Heron shut']);
  });

  it('does not find a deleted page or a child of a deleted page', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    const parent = await page(bea.client, 'eng', 'Pelican parent');
    await page(bea.client, 'eng', 'Pelican child', undefined, parent);
    const lone = await page(bea.client, 'eng', 'Pelican lone');
    expect(titles((await search(bea.client, 'pelican')).results).sort()).toEqual(['Pelican child', 'Pelican lone', 'Pelican parent']);

    expect((await bea.client.del(`/api/pages/${parent}`)).status).toBe(200);
    expect(titles((await search(bea.client, 'pelican')).results)).toEqual(['Pelican lone']);
    expect((await bea.client.del(`/api/pages/${lone}`)).status).toBe(200);
    expect((await search(bea.client, 'pelican')).results).toEqual([]);
  });

  it('a child under a deleted parent stays hidden even if its own row was missed', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    const parent = await page(bea.client, 'eng', 'Top');
    await page(bea.client, 'eng', 'Orphan ibis', undefined, parent);
    // Mark only the parent deleted, leaving the child row live.
    const { createDb } = await import('../src/db/client.js');
    const { inject } = await import('vitest');
    const { pool } = createDb(inject('databaseUrl'));
    await pool.query('update pages set deleted_at = now() where id = $1', [parent]);
    await pool.end();
    expect((await search(bea.client, 'ibis')).results).toEqual([]);
  });

  it('finds a page from a partial last word of its title', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    await page(bea.client, 'eng', 'Release notes');
    await page(bea.client, 'eng', 'Other', 'release is mentioned in the body only');
    expect(titles((await search(bea.client, 'relea')).results)).toEqual(['Release notes']);
    expect(titles((await search(bea.client, 'notes relea')).results)).toEqual(['Release notes']);
    expect(titles((await search(bea.client, 'Relea')).results)).toEqual(['Release notes']);
  });

  it('answers 200 with safe results for any odd input', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    await page(bea.client, 'eng', 'The plan', 'Some words.');

    for (const q of ['', '   ', 'the']) {
      const res = await bea.client.get(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ results: [] });
    }
    expect((await bea.client.get('/api/search')).body).toEqual({ results: [] });

    const odd = ['"plan', 'plan"', '"', "'", 'plan & words', '&', '|', 'a | b', '!', '!plan', ':*', 'plan:*', '(', 'plan (', ')', '-', 'or', 'x'.repeat(1000), 'план', '日本語のページ', 'مرحبا', '\u0000plan', '<b>plan</b>', '\\', '%', '_'];
    for (const q of odd) {
      const res = await bea.client.get(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status, `query ${JSON.stringify(q)}`).toBe(200);
      expect(Array.isArray(res.body.results)).toBe(true);
    }
    // A repeated parameter is handled too.
    expect((await bea.client.get('/api/search?q=plan&q=other')).status).toBe(200);
  });

  it('cuts a query to 200 characters', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    await page(bea.client, 'eng', 'Albatross');
    // The real word sits past character 200, so it is cut away and not searched.
    const long = `${'zz '.repeat(70)}albatross`;
    expect(long.length).toBeGreaterThan(200);
    expect((await search(bea.client, long)).results).toEqual([]);
    // A long query whose word is inside the first 200 characters still works.
    expect(titles((await search(bea.client, `albatross ${'.'.repeat(300)}`)).results)).toEqual(['Albatross']);
  });

  it('defaults to 20 results and never returns more than 50', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    for (let i = 0; i < 55; i++) await page(bea.client, 'eng', `Gannet ${i}`);
    expect((await search(bea.client, 'gannet')).results).toHaveLength(20);
    expect((await search(bea.client, 'gannet', '&limit=500')).results).toHaveLength(50);
    expect((await search(bea.client, 'gannet', '&limit=5')).results).toHaveLength(5);
    expect((await search(bea.client, 'gannet', '&limit=nope')).results).toHaveLength(20);
    expect((await search(bea.client, 'gannet', '&limit=-3')).results).toHaveLength(20);
  });

  it('returns HTML-looking page text only as data, with no tags added', async () => {
    const { bea, page } = await team();
    await bea.client.post('/api/spaces', { key: 'eng', name: 'Engineering' });
    const payload = '<img src=x onerror=alert(1)>';
    await page(bea.client, 'eng', payload, `kestrel ${payload} kestrel`);
    await page(bea.client, 'eng', `Sneaky ${HIT_START}marker${HIT_END}`, `osprey with ${HIT_START}fake${HIT_END} markers`);

    const [hit] = (await search(bea.client, 'kestrel')).results;
    expect(hit!.title).toBe(payload);
    expect(plain(hit!.snippet)).toContain(payload);
    // The only markup in the snippet is the hit markers; the one '<…>' is the page's own text.
    expect(hit!.snippet.replace(payload, '')).not.toMatch(/[<>]/);
    expect(splitSnippet(hit!.snippet).filter((p) => p.hit).map((p) => p.text)).toEqual(['kestrel', 'kestrel']);

    // Marker characters typed into a page are stripped, so they cannot fake a hit.
    const [sneaky] = (await search(bea.client, 'osprey')).results;
    expect(splitSnippet(sneaky!.snippet).filter((p) => p.hit).map((p) => p.text)).toEqual(['osprey']);
  });

  it('matches through the GIN index on pages.search', async () => {
    const { bea } = await team();
    const { sql } = await import('drizzle-orm');
    const { createDb } = await import('../src/db/client.js');
    const { inject } = await import('vitest');
    const { parseQuery, searchSql } = await import('../src/search/search.js');
    const { pool, db } = createDb(inject('databaseUrl'));
    try {
      const user = { id: bea.user.id, role: 'editor' as const };
      const plan = await db.transaction(async (tx) => {
        // A near-empty table would be scanned anyway; ask the planner to show the index path.
        await tx.execute(sql`set local enable_seqscan = off`);
        const res = await tx.execute<{ 'QUERY PLAN': string }>(sql`explain ${searchSql(user, parseQuery('release notes')!, 20)}`);
        return res.rows.map((r) => r['QUERY PLAN']).join('\n');
      });
      expect(plan).toContain('pages_search_idx');
    } finally {
      await pool.end();
    }
  });

  it('refuses a signed-out caller with 401', async () => {
    await team();
    const res = await new Client(ctx.app).get('/api/search?q=anything');
    expect(res.status).toBe(401);
  });
});
