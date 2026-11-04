// StubProvider: deterministic, no network, no timers. Every automated test
// uses it (or a fake), so tests cost nothing.
//
// It reads the same message shapes the real prompts send (prompts.ts, 4b/4c):
// - ask: the last user message holds <question>…</question> and numbered
//   sources <source n="1" …>…</source>. The answer quotes the first sentence
//   of source 1 and cites it with " [1]". No sources: it says it found nothing.
// - otherwise, summarise: the text inside <page …>…</page> (or the whole
//   message), cut to its first two sentences.
import type { AiMessage, AiProvider } from './provider.js';

export const STUB_NOTHING_FOUND = "I couldn't find anything about that in your pages.";
export const STUB_EMPTY_SUMMARY = 'This page has no text to summarise yet.';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The first `n` sentences of `text` (a sentence ends with . ! or ? and a space or the end). */
export function firstSentences(text: string, n: number): string {
  const flat = squash(text);
  const found = flat.match(/[^.!?]*[.!?]+(?=\s|$)/g) ?? [];
  const picked = found.slice(0, n).map((s) => s.trim()).filter(Boolean);
  return picked.length ? picked.join(' ') : flat;
}

export class StubProvider implements AiProvider {
  readonly name = 'stub';

  async complete(req: { system: string; messages: AiMessage[]; maxTokens: number }): Promise<{ text: string }> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    if (/<question[\s>]/.test(last) || /<source[\s>]/.test(last)) {
      const first = /<source\b[^>]*\bn="1"[^>]*>([\s\S]*?)<\/source>/.exec(last);
      const quote = first ? firstSentences(first[1]!, 1) : '';
      return { text: quote ? `"${quote}" [1]` : STUB_NOTHING_FOUND };
    }

    const page = /<page\b[^>]*>([\s\S]*?)<\/page>/.exec(last);
    const summary = firstSentences(page ? page[1]! : last, 2);
    return { text: summary || STUB_EMPTY_SUMMARY };
  }
}
