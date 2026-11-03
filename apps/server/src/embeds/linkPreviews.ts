// Link preview cards: fetch Open Graph data once through the guarded fetcher
// and keep it in `link_previews`. A refused or failed URL gives a card with
// only the URL, so the editor shows a plain link instead of an error.
import { eq } from 'drizzle-orm';
import type { LinkPreview } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { linkPreviews } from '../db/schema.js';
import { badRequest } from '../http.js';
import { parseOpenGraph } from './openGraph.js';
import { checkUrlShape, FetchRefused, safeFetchPage, type SafeFetchOptions } from './safeFetch.js';

/** How long a card is reused before it is fetched again. */
export const CACHE_MS = { found: 7 * 24 * 3600_000, empty: 3600_000 } as const;

const MAX_URL = 2048;

/** Validates and normalises a URL from the client; 400 when it is not a web link. */
export function normalizePreviewUrl(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > MAX_URL) {
    throw badRequest('Give a web address (http or https)');
  }
  let u: URL;
  try {
    u = new URL(input.trim());
    checkUrlShape(u);
  } catch {
    throw badRequest('Give a web address (http or https)');
  }
  u.hash = '';
  return u.href;
}

export type PreviewOutcome = 'cached' | 'fetched' | 'refused' | 'failed';

export interface PreviewResult {
  preview: LinkPreview;
  outcome: PreviewOutcome;
}

const empty = (url: string): LinkPreview => ({ url, title: null, description: null, siteName: null, imageUrl: null });

const hasContent = (p: LinkPreview) => !!(p.title || p.description || p.siteName || p.imageUrl);

/** Fetches one URL into a card. Never throws: refusals and failures give an empty card. */
export async function fetchLinkPreview(url: string, opts: SafeFetchOptions = {}): Promise<PreviewResult> {
  try {
    const page = await safeFetchPage(url, opts);
    if (!page.html) return { preview: empty(url), outcome: 'fetched' };
    return { preview: { url, ...parseOpenGraph(page.html, page.url) }, outcome: 'fetched' };
  } catch (err) {
    return { preview: empty(url), outcome: err instanceof FetchRefused ? 'refused' : 'failed' };
  }
}

/** The card for `url` (already normalised): from the cache when fresh, else fetched and stored. */
export async function getLinkPreview(
  db: Db,
  url: string,
  opts: SafeFetchOptions = {},
  now = Date.now(),
): Promise<PreviewResult> {
  const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url));
  if (row) {
    const preview: LinkPreview = {
      url: row.url,
      title: row.title,
      description: row.description,
      siteName: row.siteName,
      imageUrl: row.imageUrl,
    };
    const ttl = hasContent(preview) ? CACHE_MS.found : CACHE_MS.empty;
    if (now - row.fetchedAt.getTime() < ttl) return { preview, outcome: 'cached' };
  }
  const result = await fetchLinkPreview(url, opts);
  const values = { ...result.preview, fetchedAt: new Date(now) };
  await db
    .insert(linkPreviews)
    .values(values)
    .onConflictDoUpdate({ target: linkPreviews.url, set: values });
  return result;
}
