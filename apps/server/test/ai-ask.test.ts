// Stage 4c: ask-your-docs retrieval against real Postgres
// (docs/done-checks/04-ai.md, 4c). retrieveSources must only ever return
// sections of pages the asker can read, never deleted pages or their children,
// and nothing for a question that matches no page. Runs under `npm run test:ai`
// and `npm test`. Nothing here reaches the network: fetch is a trap.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  CHUNK_MAX_CHARS,
  MAX_SOURCES,
  chunkDoc,
  orQuery,
  questionWords,
  retrieveSources,
  retrieveSql,
  type Source,
} from '../src/ai/retrieve.js';
import { Client, setupApp, signup, type TestCtx } from './helpers.js';

// ---------- No network ----------

const realFetch = globalThis.fetch;
const fetchCalls: string[] = [];
beforeAll(() => {
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error('ai-ask.test.ts: network is not allowed in tests');
  }) as typeof fetch;
});
afterEach(() => {
  expect(fetchCalls, 'a test called fetch').toEqual([]);
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------- Helpers ----------

let ctx: TestCtx | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function start() {
  ctx = await setupApp({ AI_PROVIDER: 'stub' });
  await ctx.reset();
  return ctx;
}

type Block = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
const p = (text: string): Block => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const h = (text: string, level = 2): Block => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const docOf = (...blocks: Block[]) => ({ type: 'doc', content: blocks });

async function makePage(c: Client, space: string, title: string, blocks: Block[], parentId: string | null = null) {
  const res = await c.post(`/api/spaces/${space}/pages`, { title, parentId });
  expect(res.status).toBe(201);
  const page = res.body.page as { id: string; version: number };
  if (blocks.length) {
    const saved = await c.put(`/api/pages/${page.id}`, { baseVersion: page.version, doc: docOf(...blocks) });
    expect(saved.status).toBe(200);
  }
  return page.id;
}

type Who = { id: string; role: 'admin' | 'editor' | 'viewer' };
const asUser = (u: { user: { id: string; role: string } }): Who => ({ id: u.user.id, role: u.user.role as Who['role'] });

/**
 * Ada: instance admin. Bea: editor, member (editor) of open "eng". Di: editor, no member anywhere.
 * Vi: instance viewer, no member anywhere. "hr" is restricted and Bea's.
 */
async function team(t: TestCtx) {
  const ada = await signup(t.app, 'Ada');
  const bea = await signup(t.app, 'Bea');
  const di = await signup(t.app, 'Di');
  const vi = await signup(t.app, 'Vi');
  expect((await ada.client.patch(`/api/users/${vi.user.id}`, { role: 'viewer' })).status).toBe(200);
  vi.user.role = 'viewer';
  expect((await ada.client.post('/api/spaces', { key: 'eng', name: 'Engineering' })).status).toBe(201);
  expect((await ada.client.put(`/api/spaces/eng/members/${bea.user.id}`, { role: 'editor' })).status).toBe(200);
  expect((await bea.client.post('/api/spaces', { key: 'hr', name: 'People', visibility: 'restricted' })).status).toBe(201);
  return { ada, bea, di, vi };
}

const pageIds = (sources: Source[]) => [...new Set(sources.map((s) => s.pageId))];

// ---------- Pure parts ----------

describe('question words', () => {
  it('keeps only letters and digits, lower case, once each', () => {
    expect(questionWords("What's the Q3 plan?! plan & (deploy) | !x:*")).toEqual(['what', 's', 'the', 'q3', 'plan', 'deploy', 'x']);
    expect(questionWords('  ?!  ')).toEqual([]);
    expect(questionWords('Früh-Schicht café')).toEqual(['früh', 'schicht', 'café']);
    expect(orQuery(['deploy', 'noon'])).toBe('deploy | noon');
  });

  it('the page search is one statement with the permission filter inside it', () => {
    const q = retrieveSql({ id: '00000000-0000-4000-8000-000000000000', role: 'editor' }, ['deploy']);
    const text = new PgDialect().sqlToQuery(q).sql;
    expect(text).toContain('p.search @@ q.query');
    expect(text).toContain('p.deleted_at is null');
    expect(text).toContain('p.space_id in (');
    expect(text).toContain("to_tsquery('english'");
    expect(text).not.toContain('websearch_to_tsquery');
    expect(text).toContain('space_members'); // visibleSpaceIds, rendered inside the same statement
    expect(text.match(/\bselect\b/gi)!.length).toBeGreaterThan(1);
  });
});

describe('chunkDoc', () => {
  it('splits at headings: each chunk is a heading and the blocks under it', () => {
    const chunks = chunkDoc(
      docOf(p('Intro line.'), h('Deploys'), p('Run at noon.'), p('Ask first.'), h('Rollback', 3), p('Use the button.'), h('Empty section')),
    );
    expect(chunks).toEqual(['Intro line.', 'Deploys\nRun at noon.\nAsk first.', 'Rollback\nUse the button.', 'Empty section']);
  });

  it('drops empty chunks and cuts each one to 1,500 characters', () => {
    expect(chunkDoc(docOf(p(''), p('')))).toEqual([]);
    const long = chunkDoc(docOf(h('Long'), p('x'.repeat(4000))));
    expect(long).toHaveLength(1);
    expect(CHUNK_MAX_CHARS).toBe(1500);
    expect(long[0]!.length).toBe(CHUNK_MAX_CHARS);
  });

  it('falls back to the saved plain text when a stored body no longer parses', () => {
    expect(chunkDoc({ type: 'doc', content: [{ type: 'nope' }] }, ' Saved text. ')).toEqual(['Saved text.']);
    expect(chunkDoc(null, '')).toEqual([]);
  });
});

// ---------- Real Postgres ----------

describe('retrieveSources', () => {
  it('finds a page in an open space, numbered from [1] with page, title and space', async () => {
    const t = await start();
    const { bea, vi } = await team(t);
    const id = await makePage(bea.client, 'eng', 'Runbook', [p('Deploys run at noon on weekdays.'), h('Rollback'), p('Press the big button.')]);
    await makePage(bea.client, 'eng', 'Lunch', [p('Soup on Fridays.')]);

    const sources = await retrieveSources(t.db, asUser(vi), 'When do deploys run?');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toEqual({
      n: 1,
      pageId: id,
      title: 'Runbook',
      spaceKey: 'eng',
      spaceName: 'Engineering',
      text: 'Deploys run at noon on weekdays.',
    });
    expect(pageIds(sources)).toEqual([id]);
    sources.forEach((s, i) => expect(s.n).toBe(i + 1));
  });

  it('ranks sections by most question words, then page rank, and keeps at most 8', async () => {
    const t = await start();
    const { bea } = await team(t);
    const blocks: Block[] = [];
    for (let i = 1; i <= 6; i++) blocks.push(h(`Part ${i}`), p(i === 4 ? 'The heron nests by the lake.' : `Heron note ${i}.`));
    const big = await makePage(bea.client, 'eng', 'Birds', blocks);
    const other = await makePage(bea.client, 'eng', 'More birds', [h('A'), p('Heron again.'), h('B'), p('Heron once more.'), h('C'), p('Heron.')]);

    const sources = await retrieveSources(t.db, asUser(bea), 'heron lake');
    expect(MAX_SOURCES).toBe(8);
    expect(sources).toHaveLength(8);
    // The only section holding both words comes first.
    expect(sources[0]!.text).toBe('Part 4\nThe heron nests by the lake.');
    expect(sources[0]!.pageId).toBe(big);
    expect(pageIds(sources).sort()).toEqual([big, other].sort());
    sources.forEach((s, i) => expect(s.n).toBe(i + 1));
  });

  it('uses the same stemming as search, and the OR of the words', async () => {
    const t = await start();
    const { bea } = await team(t);
    const a = await makePage(bea.client, 'eng', 'Deploying', [p('We deployed twice.')]);
    const b = await makePage(bea.client, 'eng', 'Kettles', [p('The kettle is broken.')]);
    const found = await retrieveSources(t.db, asUser(bea), 'deploy or kettles?');
    expect(pageIds(found).sort()).toEqual([a, b].sort());
  });

  it('never returns a restricted page to a non-member, even when it matches better; membership turns it on and off', async () => {
    const t = await start();
    const { bea, di } = await team(t);
    const secretText = 'Zephyrine salary bands zephyrine zephyrine budget.';
    const secret = await makePage(bea.client, 'hr', 'Zephyrine salary bands', [p(secretText)]);
    const open = await makePage(bea.client, 'eng', 'Notes', [p('Zephyrine is mentioned once.')]);

    const question = 'zephyrine salary bands';
    const before = await retrieveSources(t.db, asUser(di), question);
    expect(pageIds(before)).toEqual([open]);
    expect(JSON.stringify(before)).not.toContain('salary');

    // The member (Bea) sees the better page first.
    expect((await retrieveSources(t.db, asUser(bea), question))[0]!.pageId).toBe(secret);

    expect((await bea.client.put(`/api/spaces/hr/members/${di.user.id}`, { role: 'viewer' })).status).toBe(200);
    const member = await retrieveSources(t.db, asUser(di), question);
    expect(member[0]!.pageId).toBe(secret);
    expect(member[0]!.spaceKey).toBe('hr');

    expect((await bea.client.del(`/api/spaces/hr/members/${di.user.id}`)).status).toBe(200);
    const after = await retrieveSources(t.db, asUser(di), question);
    expect(pageIds(after)).toEqual([open]);
    expect(JSON.stringify(after)).not.toContain('salary');
  });

  it('lets an instance viewer ask over open spaces and an instance admin over every space', async () => {
    const t = await start();
    const { ada, bea, vi } = await team(t);
    const open = await makePage(bea.client, 'eng', 'Open quokka', [p('A quokka in the open.')]);
    const closed = await makePage(bea.client, 'hr', 'Closed quokka', [p('A quokka behind the door.')]);
    expect(pageIds(await retrieveSources(t.db, asUser(vi), 'quokka'))).toEqual([open]);
    expect(pageIds(await retrieveSources(t.db, asUser(ada), 'quokka')).sort()).toEqual([open, closed].sort());
  });

  it('never returns a deleted page or a child of a deleted page', async () => {
    const t = await start();
    const { ada, bea } = await team(t);
    const parent = await makePage(bea.client, 'eng', 'Old wombat plan', [p('Wombat plan one.')]);
    const child = await makePage(bea.client, 'eng', 'Wombat child', [p('Wombat plan two.')], parent);
    const grandchild = await makePage(bea.client, 'eng', 'Wombat grandchild', [p('Wombat plan three.')], child);
    const alive = await makePage(bea.client, 'eng', 'Living wombat', [p('Wombat plan four.')]);
    expect(pageIds(await retrieveSources(t.db, asUser(ada), 'wombat')).sort()).toEqual([parent, child, grandchild, alive].sort());

    expect((await bea.client.del(`/api/pages/${parent}`)).status).toBe(200);
    const found = await retrieveSources(t.db, asUser(ada), 'wombat plan');
    expect(pageIds(found)).toEqual([alive]);
  });

  it('returns nothing for a question that matches no page, only stop words, or no words at all', async () => {
    const t = await start();
    const { ada, bea } = await team(t);
    await makePage(bea.client, 'eng', 'Runbook', [p('Deploys run at noon.')]);
    for (const q of ['xylophonic marmalade', 'the and of it', '?!', '', "') | deploy & !('"]) {
      const found = await retrieveSources(t.db, asUser(ada), q);
      if (q.includes('deploy')) {
        // Syntax characters are stripped; the plain word still matches.
        expect(pageIds(found)).toHaveLength(1);
      } else {
        expect(found).toEqual([]);
      }
    }
  });

  it('takes the best 5 pages at most', async () => {
    const t = await start();
    const { bea } = await team(t);
    for (let i = 0; i < 7; i++) await makePage(bea.client, 'eng', `Gecko ${i}`, [p(`Gecko fact ${i}.`)]);
    const found = await retrieveSources(t.db, asUser(bea), 'gecko');
    expect(pageIds(found)).toHaveLength(5);
  });
});
