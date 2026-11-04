// AI features, built only on the AiProvider interface (ARCHITECTURE.md §8).
// Permission checks come first, through the same helpers every other route
// uses, so a page the user cannot read is never sent to the model.
import { eq } from 'drizzle-orm';
import { ASK_NO_SOURCES_ANSWER } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pages } from '../db/schema.js';
import { notFound } from '../http.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole } from '../pages/pages.js';
import type { AiProvider } from './provider.js';
import {
  ASK_MAX_TOKENS,
  ASK_SYSTEM,
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_SYSTEM,
  askMessages,
  summaryMessages,
} from './prompts.js';
import { retrieveSources, type Source } from './retrieve.js';

export const EMPTY_PAGE_SUMMARY = 'This page has no text to summarise yet.';

/** A short plain-text summary of a page the user may read. 404 (no provider call) otherwise. */
export async function summarisePage(db: Db, provider: AiProvider, user: SessionUser, pageId: string): Promise<string> {
  // Same 404 as GET /api/pages/:id for missing, deleted or not-visible pages.
  await requirePageRole(db, user, pageId, 'viewer');
  const [row] = await db.select({ title: pages.title, docText: pages.docText }).from(pages).where(eq(pages.id, pageId));
  if (!row) throw notFound('Page not found');

  const text = row.docText.trim();
  if (!text) return EMPTY_PAGE_SUMMARY;

  const { text: out } = await provider.complete({
    system: SUMMARY_SYSTEM,
    messages: summaryMessages(row.title, text.slice(0, SUMMARY_MAX_CHARS)),
    maxTokens: SUMMARY_MAX_TOKENS,
  });
  return out.trim();
}

// ---------- Ask your docs ----------

/** Shared with the web client, which shows the same sentence with no Sources list. */
export const NO_SOURCES_ANSWER = ASK_NO_SOURCES_ANSWER;

export interface CitedSource {
  n: number;
  pageId: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  /** The same link a search result opens. */
  url: string;
}

export const pageUrl = (spaceKey: string, pageId: string) =>
  `/s/${encodeURIComponent(spaceKey)}/p/${encodeURIComponent(pageId)}`;

/** One bracket holding one or more numbers: [2], [2, 3]. */
const CITE = /\[\s*(\d{1,3}(?:\s*,\s*\d{1,3})*)\s*\]/g;

/**
 * The server owns the citations. Every [n] in the model's text is kept only if
 * n is a source we supplied; any other [n] is removed from the text. A list
 * like [2, 3] becomes [2][3]. Returns the cleaned text and the cited sources in
 * order of first use. Links come from our list, never from model text.
 */
export function applyCitations(text: string, sources: Source[]): { answer: string; sources: CitedSource[] } {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const used: Source[] = [];
  const cleaned = text.replace(CITE, (_m, list: string) => {
    const kept = list
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => byN.has(n));
    for (const n of kept) {
      const s = byN.get(n)!;
      if (!used.includes(s)) used.push(s);
    }
    return kept.map((n) => `[${n}]`).join('');
  });
  const answer = cleaned
    .replace(/[ \t]+([.,;:!?)])/g, '$1') // a space left before punctuation by a removed marker
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return {
    answer,
    sources: used.map((s) => ({
      n: s.n,
      pageId: s.pageId,
      title: s.title,
      spaceKey: s.spaceKey,
      spaceName: s.spaceName,
      url: pageUrl(s.spaceKey, s.pageId),
    })),
  };
}

/**
 * Answer a question from the pages the user may read. Sources come only from
 * retrieveSources (permission filter inside its SQL). No sources: a fixed
 * answer and no provider call.
 */
export async function askDocs(
  db: Db,
  provider: AiProvider,
  user: SessionUser,
  question: string,
): Promise<{ answer: string; sources: CitedSource[] }> {
  const sources = await retrieveSources(db, user, question);
  if (sources.length === 0) return { answer: NO_SOURCES_ANSWER, sources: [] };

  const { text } = await provider.complete({
    system: ASK_SYSTEM,
    messages: askMessages(question, sources),
    maxTokens: ASK_MAX_TOKENS,
  });
  return applyCitations(text, sources);
}
