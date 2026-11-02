// Plain text of a page body, for search (ARCHITECTURE.md §6). Walks the
// ProseMirror JSON generically; block nodes are separated by newlines.
// When packages/editor-schema lands, this moves onto its node list.

interface PmNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

const INLINE = new Set(['text', 'hardBreak', 'mention']);

export function docToText(doc: unknown): string {
  const out: string[] = [];
  const walk = (node: PmNode) => {
    if (typeof node.text === 'string') {
      out.push(node.text);
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) if (child && typeof child === 'object') walk(child as PmNode);
    }
    if (typeof node.type === 'string' && !INLINE.has(node.type)) out.push('\n');
  };
  if (doc && typeof doc === 'object') walk(doc as PmNode);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
