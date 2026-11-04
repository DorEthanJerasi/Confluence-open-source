// AI features, built only on the AiProvider interface (ARCHITECTURE.md §8).
// Permission checks come first, through the same helpers every other route
// uses, so a page the user cannot read is never sent to the model.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pages } from '../db/schema.js';
import { notFound } from '../http.js';
import type { SessionUser } from '../auth/session.js';
import { requirePageRole } from '../pages/pages.js';
import type { AiProvider } from './provider.js';
import { SUMMARY_MAX_CHARS, SUMMARY_MAX_TOKENS, SUMMARY_SYSTEM, summaryMessages } from './prompts.js';

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
