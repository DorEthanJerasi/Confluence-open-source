// Full-text search over the pages a user may read (ARCHITECTURE.md §4, §7).
// One SQL statement does the match, the permission filter (visibleSpaceIds),
// the deleted-page filter, ranking, breadcrumbs and snippets. Nothing is
// filtered afterwards in JavaScript, so there is no second permission rule.
import { sql, type SQL } from 'drizzle-orm';
import { HIT_END, HIT_START, type Crumb, type SearchResult } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';

export const MAX_QUERY_CHARS = 200;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/** Postgres text cannot hold NUL; other control characters only add noise. */
const CONTROL = /[\u0000-\u001f\u007f]/g;
/** Anything that is not a letter or digit never reaches the prefix query. */
const NOT_WORD = /[^\p{L}\p{N}]/gu;

export interface ParsedQuery {
  /** The text for websearch_to_tsquery (cut to 200 characters). */
  text: string;
  /** Everything before the last word, for pairing with the prefix. */
  head: string;
  /** Letters and digits of the last word, for a title prefix match ('' = none). */
  prefix: string;
}

/** Clean user input. Returns null when there is nothing to search for. */
export function parseQuery(raw: unknown): ParsedQuery | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return null;
  const text = Array.from(first.replace(CONTROL, ' ')).slice(0, MAX_QUERY_CHARS).join('').trim();
  if (!text) return null;
  const words = text.split(/\s+/);
  const last = words.pop() ?? '';
  // A trailing quote or operator ends a phrase; only a bare word gets a prefix.
  const prefix = /^[\p{L}\p{N}]/u.test(last) ? last.replace(NOT_WORD, '') : '';
  return { text, head: words.join(' '), prefix };
}

export function parseLimit(raw: unknown): number {
  const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * The tsquery: the user's words as websearch syntax, OR (when the last word is
 * partial) the earlier words AND a title-only (weight A) prefix of the last
 * word, so "relea" finds "Release notes". The prefix holds letters and digits
 * only, so it cannot carry tsquery syntax.
 */
function tsQuery(q: ParsedQuery): SQL {
  const full = sql`websearch_to_tsquery('english', ${q.text})`;
  if (!q.prefix) return full;
  return sql`(${full} || (websearch_to_tsquery('english', ${q.head}) && to_tsquery('english', ${q.prefix + ':*A'})))`;
}

const HEADLINE_OPTIONS = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`;

/** The whole search as one statement (exported so a test can EXPLAIN it). */
export function searchSql(user: Pick<SessionUser, 'id' | 'role'>, q: ParsedQuery, limit: number): SQL {
  return sql`
    with q as (select ${tsQuery(q)} as query),
    hits as (
      select p.id, p.title, p.doc_text, p.space_id, p.updated_at, anc.crumbs,
             ts_rank_cd(p.search, q.query) as rank
      from pages p
      cross join q
      cross join lateral (
        with recursive up as (
          select a.id, a.parent_id, a.title, a.deleted_at, 0 as depth from pages a where a.id = p.parent_id
          union all
          select b.id, b.parent_id, b.title, b.deleted_at, up.depth + 1 from pages b join up on b.id = up.parent_id where up.depth < 1000
        )
        select coalesce(json_agg(json_build_object('id', up.id, 'title', up.title) order by up.depth desc), '[]'::json) as crumbs,
               coalesce(bool_or(up.deleted_at is not null), false) as dead
        from up
      ) anc
      where p.search @@ q.query
        and p.deleted_at is null
        and not anc.dead
        and p.space_id in (${visibleSpaceIds(user)})
      order by rank desc, p.updated_at desc, p.id
      limit ${limit}
    ),
    clean as (
      -- The hit markers can never come from page text.
      select h.*, translate(h.doc_text, ${HIT_START + HIT_END}, '') as body,
             translate(h.title, ${HIT_START + HIT_END}, '') as plain_title
      from hits h
    )
    select c.id, c.title, s.key as space_key, s.name as space_name, c.crumbs,
           case when to_tsvector('english', c.body) @@ q.query
                then ts_headline('english', c.body, q.query, ${HEADLINE_OPTIONS})
                else ts_headline('english', c.plain_title, q.query, ${HEADLINE_OPTIONS})
           end as snippet
    from clean c
    cross join q
    join spaces s on s.id = c.space_id
    order by c.rank desc, c.updated_at desc, c.id`;
}

export async function searchPages(db: Db, user: SessionUser, q: ParsedQuery, limit: number): Promise<SearchResult[]> {
  const res = await db.execute<{
    id: string;
    title: string;
    space_key: string;
    space_name: string;
    snippet: string;
    crumbs: Crumb[];
  }>(searchSql(user, q, limit));
  return res.rows.map((r) => ({
    pageId: r.id,
    title: r.title,
    spaceKey: r.space_key,
    spaceName: r.space_name,
    snippet: r.snippet,
    breadcrumbs: r.crumbs,
  }));
}
