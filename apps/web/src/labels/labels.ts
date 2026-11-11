// Small helpers shared by the label chips, the two label views and the search
// screen (docs/done-checks/13-labels.md, 13b).
import { normaliseLabel } from '@stillwater/shared';

const enc = encodeURIComponent;

/** One space's "pages with this label" view. */
export const spaceLabelPath = (spaceKey: string, name: string) => `/s/${enc(spaceKey)}/labels/${enc(name)}`;
/** The whole-wiki "pages with this label" view. */
export const wikiLabelPath = (name: string) => `/labels/${enc(name)}`;
/** The search screen for this query. */
export const searchPath = (q: string) => `/search?q=${enc(q)}`;

/** Every label query (suggestions and both views) starts with this key, so one invalidate refreshes them all. */
export const labelsKey = ['labels'] as const;

const LABEL_WORD = /^label:/i;

/**
 * Splits a search box query the way the server reads it: `label:name` words
 * become label names (normalised, each once, in order); the rest is the text.
 * A bare `label:` is dropped. A name the rule refuses stays as typed, so the
 * chip still shows what the server was asked for.
 */
export function splitQuery(q: string): { text: string; labels: string[] } {
  const text: string[] = [];
  const labels: string[] = [];
  for (const word of q.trim().split(/\s+/).filter(Boolean)) {
    if (!LABEL_WORD.test(word)) text.push(word);
    else if (word.length > 'label:'.length) {
      const raw = word.slice('label:'.length);
      const name = normaliseLabel(raw) ?? raw;
      if (!labels.includes(name)) labels.push(name);
    }
  }
  return { text: text.join(' '), labels };
}

/** Puts a query back together: the text, then one `label:name` word per label. */
export function joinQuery(text: string, labels: string[]): string {
  return [text.trim(), ...labels.map((l) => `label:${l}`)].filter(Boolean).join(' ');
}
