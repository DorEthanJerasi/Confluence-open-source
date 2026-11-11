// SQL pieces for labels that page reads (getPageView, search) share with
// labels.ts. Kept apart so pages.ts can use them without importing labels.ts.
import { sql, type SQL } from 'drizzle-orm';
import type { Label } from '@stillwater/shared';
import { labels, pageLabels } from '../db/schema.js';

/**
 * A json array of the page's labels `[{ id, name }]`, by name. `pageId` is a
 * column or value; the caller has already decided the page may be read.
 */
export function labelsJson(pageId: SQL | unknown): SQL<Label[]> {
  return sql<Label[]>`coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name) order by l.name)
    from ${pageLabels} pl join ${labels} l on l.id = pl.label_id where pl.page_id = ${pageId}), '[]'::json)`;
}

/** True when the page (column or value) has the label with this normalised name. */
export function hasLabel(pageId: SQL | unknown, name: string): SQL {
  return sql`exists (select 1 from ${pageLabels} pl join ${labels} l on l.id = pl.label_id
    where pl.page_id = ${pageId} and l.name = ${name})`;
}
