// Ask-your-docs retrieval (ARCHITECTURE.md §8, docs/done-checks/04-ai.md 4c).
// One SQL statement finds the best pages for a question. The permission filter
// (visibleSpaceIds) and the deleted-page filter sit inside that statement, so a
// page the asker cannot read never reaches this file, the model or a citation.
// Nothing is filtered afterwards in JavaScript.
import { sql, type SQL } from 'drizzle-orm';
import { getDocSchema, nodeToText, parseDoc } from '@stillwater/editor-schema';
import type { Db } from '../db/client.js';
import { visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';

type PmNode = ReturnType<typeof parseDoc>;

export const MAX_PAGES = 5;
export const MAX_SOURCES = 8;
export const CHUNK_MAX_CHARS = 1_500;
/** A 500-character question cannot hold more useful words than this. */
export const MAX_QUESTION_WORDS = 64;

export interface Source {
  /** 1-based number the model cites as [n]. */
  n: number;
  pageId: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  /** Plain text of one section: a heading and the blocks under it. */
  text: string;
}

/** Only letters and digits reach to_tsquery, so a question can never carry tsquery syntax. */
const NOT_WORD = /[^\p{L}\p{N}]+/gu;

/** The question's distinct words, lower case, letters and digits only. */
export function questionWords(question: string): string[] {
  const words = question.toLowerCase().split(NOT_WORD).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_QUESTION_WORDS);
}

/** The words joined with OR for to_tsquery. Stop words drop out inside Postgres. */
export function orQuery(words: string[]): string {
  return words.join(' | ');
}

/** The page search as one statement (exported so a test can EXPLAIN it). */
export function retrieveSql(user: Pick<SessionUser, 'id' | 'role'>, words: string[], limit = MAX_PAGES): SQL {
  return sql`
    with q as (select to_tsquery('english', ${orQuery(words)}) as query)
    select p.id, p.title, p.doc, p.doc_text, s.key as space_key, s.name as space_name,
           ts_rank_cd(p.search, q.query) as rank
    from pages p
    cross join q
    join spaces s on s.id = p.space_id
    where p.search @@ q.query
      and p.deleted_at is null
      and p.space_id in (${visibleSpaceIds(user)})
      and not exists (
        with recursive up as (
          select a.id, a.parent_id, a.deleted_at, 0 as depth from pages a where a.id = p.parent_id
          union all
          select b.id, b.parent_id, b.deleted_at, up.depth + 1 from pages b join up on b.id = up.parent_id where up.depth < 1000
        )
        select 1 from up where up.deleted_at is not null
      )
    order by rank desc, p.updated_at desc, p.id
    limit ${limit}`;
}

type PageHit = {
  id: string;
  title: string;
  doc: unknown;
  doc_text: string;
  space_key: string;
  space_name: string;
};

/**
 * Split a page at its heading blocks: each chunk is a heading and the blocks
 * under it (text before the first heading is its own chunk). Text comes from
 * nodeToText, cut to 1,500 characters. Empty chunks are dropped.
 */
export function chunkDoc(doc: unknown, fallbackText = ''): string[] {
  let node: PmNode;
  try {
    node = parseDoc(doc);
  } catch {
    // A stored body that no longer parses still has its saved plain text.
    const text = fallbackText.trim();
    return text ? [cut(text)] : [];
  }
  const groups: PmNode[][] = [];
  let current: PmNode[] = [];
  node.forEach((block) => {
    if (block.type.name === 'heading' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  });
  if (current.length > 0) groups.push(current);

  const schema = getDocSchema();
  return groups
    .map((blocks) => nodeToText(schema.topNodeType.create(null, blocks)))
    .filter((text) => text.length > 0)
    .map(cut);
}

function cut(text: string): string {
  return Array.from(text).slice(0, CHUNK_MAX_CHARS).join('');
}

/**
 * How many of the question's words each text holds, by Postgres's own English
 * stemmer (the one the search index uses), so "deploys" counts for "deploy".
 * This only reads text the server already holds; it touches no table.
 */
async function wordHits(db: Db, words: string[], texts: string[]): Promise<number[]> {
  if (texts.length === 0) return [];
  const res = await db.execute<{ i: number; hits: number }>(sql`
    with q as (select tsvector_to_array(to_tsvector('english', ${words.join(' ')})) as lexemes)
    select t.i::int as i,
           (select count(*) from unnest(tsvector_to_array(to_tsvector('english', t.body))) l where l = any(q.lexemes))::int as hits
    from unnest(array[${sql.join(texts.map((x) => sql`${x}`), sql`, `)}]::text[]) with ordinality as t(body, i)
    cross join q`);
  const hits = new Array<number>(texts.length).fill(0);
  for (const r of res.rows) hits[r.i - 1] = r.hits;
  return hits;
}

/**
 * The numbered sources [1]…[8] for a question: the best 5 readable pages, split
 * at headings, ranked by most question words and then page rank.
 */
export async function retrieveSources(db: Db, user: Pick<SessionUser, 'id' | 'role'>, question: string): Promise<Source[]> {
  const words = questionWords(question);
  if (words.length === 0) return [];
  const res = await db.execute<PageHit>(retrieveSql(user, words));

  const chunks: { pageIndex: number; order: number; page: PageHit; text: string }[] = [];
  res.rows.forEach((page, pageIndex) => {
    chunkDoc(page.doc, page.doc_text).forEach((text, order) => chunks.push({ pageIndex, order, page, text }));
  });
  // The title is part of what the model sees for a source, so its words count too.
  const hits = await wordHits(db, words, chunks.map((c) => `${c.page.title}\n${c.text}`));

  return chunks
    .map((c, i) => ({ ...c, hits: hits[i] ?? 0 }))
    .sort((a, b) => b.hits - a.hits || a.pageIndex - b.pageIndex || a.order - b.order)
    .slice(0, MAX_SOURCES)
    .map((c, i) => ({
      n: i + 1,
      pageId: c.page.id,
      title: c.page.title,
      spaceKey: c.page.space_key,
      spaceName: c.page.space_name,
      text: c.text,
    }));
}
