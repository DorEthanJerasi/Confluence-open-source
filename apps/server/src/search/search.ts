// Full-text search over the pages a user may read (ARCHITECTURE.md §4, §7).
// One SQL statement does the match, the label filter (done-check 13), the
// permission filter (visibleSpaceIds), the deleted-page filter, ranking,
// breadcrumbs, snippets and each page's labels. Nothing is filtered afterwards
// in JavaScript, so there is no second permission rule.
import { sql, type SQL } from 'drizzle-orm';
import { HIT_END, HIT_START, SEARCH_LABELS_LIMIT, normaliseLabel, type Crumb, type Label, type SearchResult } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { visibleSpaceIds } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { hasLabel, labelsJson } from '../labels/labelSql.js';

export const MAX_QUERY_CHARS = 200;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/** Postgres text cannot hold NUL; other control characters only add noise. */
const CONTROL = /[\u0000-\u001f\u007f]/g;
/** Anything that is not a letter or digit never reaches the prefix query. */
const NOT_WORD = /[^\p{L}\p{N}]/gu;
/** A `label:name` word in the search box. */
const LABEL_WORD = /^label:/i;

export interface ParsedQuery {
  /** The text for websearch_to_tsquery (cut to 200 characters); '' = labels only. */
  text: string;
  /** Everything before the last word, for pairing with the prefix. */
  head: string;
  /** Letters and digits of the last word, for a title prefix match ('' = none). */
  prefix: string;
  /** Normalised label names a page must all have (from `label=` and `label:` words). */
  labels: string[];
  /** A label that can never match (a bad name, or more than a page can hold): no results. */
  impossible: boolean;
}

const asList = (raw: unknown): unknown[] => (raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw]);

/**
 * Clean user input. `label:name` words in `raw` and every `label=` value join
 * the label filter; a bare `label:` is ignored. Returns null when there is
 * nothing to search for.
 */
export function parseQuery(raw: unknown, rawLabels?: unknown): ParsedQuery | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const cut = typeof first === 'string' ? Array.from(first.replace(CONTROL, ' ')).slice(0, MAX_QUERY_CHARS).join('').trim() : '';
  const names: unknown[] = asList(rawLabels);
  const words: string[] = [];
  for (const word of cut ? cut.split(/\s+/) : []) {
    if (!LABEL_WORD.test(word)) words.push(word);
    else if (word.length > 'label:'.length) names.push(word.slice('label:'.length));
  }
  const labels = new Set<string>();
  let impossible = false;
  for (const n of names) {
    const name = normaliseLabel(n);
    if (name) labels.add(name);
    else impossible = true;
  }
  // A page holds at most this many labels, so asking for more can match nothing.
  if (labels.size > SEARCH_LABELS_LIMIT) impossible = true;
  const text = words.join(' ');
  if (!text && labels.size === 0 && !impossible) return null;
  const last = words.pop() ?? '';
  // A trailing quote or operator ends a phrase; only a bare word gets a prefix.
  const prefix = /^[\p{L}\p{N}]/u.test(last) ? last.replace(NOT_WORD, '') : '';
  return { text, head: words.join(' '), prefix, labels: [...labels], impossible };
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

/**
 * The whole search as one statement (exported so a test can EXPLAIN it). With
 * words: ranked text matches. With labels only: the labelled pages by last
 * change, newest first. Either way a page must have every label asked for.
 */
export function searchSql(user: Pick<SessionUser, 'id' | 'role'>, q: ParsedQuery, limit: number): SQL {
  const words = q.text !== '';
  const query = words ? tsQuery(q) : sql`null::tsquery`;
  const match = words ? sql`p.search @@ q.query` : sql`true`;
  const rank = words ? sql`ts_rank_cd(p.search, q.query)` : sql`0::real`;
  const labelled = q.labels.map((name) => sql` and ${hasLabel(sql`p.id`, name)}`);
  const snippet = words
    ? sql`case when to_tsvector('english', c.body) @@ q.query
                then ts_headline('english', c.body, q.query, ${HEADLINE_OPTIONS})
                else ts_headline('english', c.plain_title, q.query, ${HEADLINE_OPTIONS})
           end`
    : sql`left(c.body, 200)`;
  return sql`
    with q as (select ${query} as query),
    hits as (
      select p.id, p.title, p.doc_text, p.space_id, p.updated_at, anc.crumbs,
             ${rank} as rank
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
      where ${match}
        and p.deleted_at is null
        and not anc.dead
        and p.space_id in (${visibleSpaceIds(user)})${sql.join(labelled)}
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
           ${snippet} as snippet,
           ${labelsJson(sql`c.id`)} as labels
    from clean c
    cross join q
    join spaces s on s.id = c.space_id
    order by c.rank desc, c.updated_at desc, c.id`;
}

export async function searchPages(db: Db, user: SessionUser, q: ParsedQuery, limit: number): Promise<SearchResult[]> {
  if (q.impossible) return [];
  const res = await db.execute<{
    id: string;
    title: string;
    space_key: string;
    space_name: string;
    snippet: string;
    crumbs: Crumb[];
    labels: Label[];
  }>(searchSql(user, q, limit));
  return res.rows.map((r) => ({
    pageId: r.id,
    title: r.title,
    spaceKey: r.space_key,
    spaceName: r.space_name,
    snippet: r.snippet,
    breadcrumbs: r.crumbs,
    labels: r.labels,
  }));
}
