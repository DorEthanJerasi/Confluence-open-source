// Small helpers shared by the comments panel and the block margin
// (docs/done-checks/07-comments.md, 7b).
import type { Editor } from '@tiptap/react';
import type { CommentThread, Doc } from '@stillwater/shared';

export const commentsKey = (pageId: string) => ['comments', pageId] as const;

type Json = { type?: string; text?: string; content?: Json[]; attrs?: Record<string, unknown> };

const BLOCK_NAMES: Record<string, string> = {
  image: 'Image',
  file: 'File',
  video: 'Video',
  linkPreview: 'Link preview',
  table: 'Table',
  horizontalRule: 'Divider',
  codeBlock: 'Code block',
};

function textOf(node: Json): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return '\n';
  const kids = node.content ?? [];
  const inline = kids.some((k) => typeof k.text === 'string' || k.type === 'hardBreak');
  return kids.map(textOf).join(inline ? '' : '\n');
}

/** A short quote of a block's first line, or the kind of block when it has no text. */
export function blockQuote(doc: Doc | Json, blockId: string): string | null {
  const block = ((doc as Json).content ?? []).find((b) => b.attrs?.id === blockId);
  if (!block) return null;
  const line = textOf(block)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return BLOCK_NAMES[block.type ?? ''] ?? 'Empty block';
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** The DOM node of the top-level block with this id in the live editor, if it is there. */
export function blockElement(editor: Editor | null, blockId: string): HTMLElement | null {
  if (!editor || editor.isDestroyed) return null;
  let found: HTMLElement | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found || node.attrs.id !== blockId) return;
    const dom = editor.view.nodeDOM(offset);
    if (dom instanceof HTMLElement) found = dom;
  });
  return found;
}

/** Scrolls a block into view (instantly under reduced motion). */
export function scrollToBlock(el: HTMLElement) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

export const openThreads = (threads: CommentThread[] | undefined) => (threads ?? []).filter((t) => !t.resolvedAt);
