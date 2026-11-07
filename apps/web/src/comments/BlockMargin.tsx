// The comment margin beside the page body (done-check 07, 7b): a quiet marker
// on each block with open threads, and a small "comment" button on the block
// under the mouse or the caret. Everything here is an overlay drawn from the
// editor's block positions; nothing is added to the document, so no comment
// action changes pages.doc or starts an autosave.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { CommentThread } from '@stillwater/shared';

type Spot = { id: string; top: number; height: number };

/** Where each top-level block sits, relative to the layer. */
function measure(editor: Editor, layer: HTMLElement): Spot[] {
  if (editor.isDestroyed) return [];
  const base = layer.getBoundingClientRect().top;
  const spots: Spot[] = [];
  editor.state.doc.forEach((node, offset) => {
    const id = node.attrs.id as string | null | undefined;
    const dom = editor.view.nodeDOM(offset);
    if (!id || !(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    spots.push({ id, top: r.top - base, height: r.height });
  });
  return spots;
}

/** The id of the top-level block that holds `target`, if any. */
function blockAt(editor: Editor, target: Node | null): string | null {
  if (editor.isDestroyed || !target) return null;
  const root = editor.view.dom;
  let el: Node | null = target;
  while (el && el.parentNode !== root) el = el.parentNode;
  if (!el) return null;
  let id: string | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (!id && editor.view.nodeDOM(offset) === el) id = (node.attrs.id as string | null) ?? null;
  });
  return id;
}

export function BlockMargin({
  editor,
  host,
  threads,
  flash,
  onAdd,
  onOpen,
}: {
  editor: Editor | null;
  /** The element that holds the editor; hover is read from it. */
  host: RefObject<HTMLElement>;
  threads: CommentThread[];
  /** A block to highlight briefly (after "go to block" in the panel); the key restarts it. */
  flash: { blockId: string; key: number } | null;
  onAdd: (blockId: string) => void;
  onOpen: (threadId: string) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [caret, setCaret] = useState<string | null>(null);
  // Whichever moved last decides: the mouse, or the caret (typing a new block).
  const [lastMoved, setLastMoved] = useState<'mouse' | 'caret'>('mouse');
  const lastHover = useRef<string | null>(null);

  const remeasure = useCallback(() => {
    if (editor && layer.current) setSpots(measure(editor, layer.current));
  }, [editor]);

  // Re-measure when the text, the window or the page's height changes.
  useLayoutEffect(() => {
    if (!editor) return;
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(remeasure);
    };
    remeasure();
    editor.on('update', soon);
    window.addEventListener('resize', soon);
    const ro = new ResizeObserver(soon);
    ro.observe(editor.view.dom);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('update', soon);
      window.removeEventListener('resize', soon);
      ro.disconnect();
    };
  }, [editor, remeasure]);

  // Re-measure when the thread list changes (markers come and go).
  useLayoutEffect(remeasure, [threads, remeasure]);

  // Hover: the block under the mouse. Leaving the body (and its margin) hides the button.
  useEffect(() => {
    const el = host.current;
    if (!el || !editor) return;
    const move = (e: MouseEvent) => {
      if (layer.current?.contains(e.target as Node)) return;
      const id = blockAt(editor, e.target as Node);
      if (id === lastHover.current) return;
      lastHover.current = id;
      setHovered(id);
      setLastMoved('mouse');
    };
    const leave = () => {
      lastHover.current = null;
      setHovered(null);
    };
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mousemove', move);
      el.removeEventListener('mouseleave', leave);
    };
  }, [editor, host]);

  // Focus: the block that holds the caret while the editor has focus.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (editor.isDestroyed || !editor.view.hasFocus()) return;
      const { $from } = editor.state.selection;
      const node = $from.depth > 0 ? $from.node(1) : editor.state.doc.maybeChild($from.index(0));
      setCaret((node?.attrs.id as string | null | undefined) ?? null);
      setLastMoved('caret');
    };
    const blur = ({ event }: { event: FocusEvent }) => {
      // Keep the button while focus moves onto it, so it can be reached with Tab.
      if (!layer.current?.contains(event.relatedTarget as Node)) setCaret(null);
    };
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', blur);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('blur', blur);
    };
  }, [editor]);

  if (!editor) return <div className="comment-layer" ref={layer} />;

  // Open threads by block, oldest first, so a marker opens the first one.
  const byBlock = new Map<string, CommentThread[]>();
  for (const t of threads) {
    if (t.resolvedAt || !t.blockId || t.blockMissing) continue;
    byBlock.set(t.blockId, [...(byBlock.get(t.blockId) ?? []), t]);
  }
  for (const list of byBlock.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const active = lastMoved === 'caret' ? (caret ?? hovered) : (hovered ?? caret);
  const flashSpot = flash ? spots.find((s) => s.id === flash.blockId) : undefined;

  return (
    <div className="comment-layer" ref={layer}>
      {flashSpot && (
        <div
          key={flash!.key}
          className="comment-flash"
          style={{ top: flashSpot.top, height: flashSpot.height }}
          aria-hidden="true"
        />
      )}
      {spots.map((s) => {
        const list = byBlock.get(s.id);
        const showAdd = s.id === active;
        if (!list && !showAdd) return null;
        return (
          <div key={s.id} className="comment-gutter" style={{ top: s.top }} data-block={s.id}>
            {list && (
              <button
                type="button"
                className="comment-marker fade-in"
                onClick={() => onOpen(list[0].id)}
                aria-label={`${list.length} open ${list.length === 1 ? 'thread' : 'threads'} on this block`}
                title="Open comments on this block"
              >
                <MessageSquare size={14} aria-hidden="true" />
                {list.length > 1 && <span className="comment-marker-count">{list.length}</span>}
              </button>
            )}
            {showAdd && (
              <button
                type="button"
                className="comment-add fade-in"
                // Keep the editor's selection (and its focus) while clicking.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAdd(s.id)}
                aria-label="Comment on this block"
                title="Comment on this block"
              >
                <MessageSquarePlus size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
