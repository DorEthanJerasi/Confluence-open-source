// The `/` menu: type a slash anywhere outside a code block, filter by typing,
// pick with arrows + Enter or a click, close with Esc.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentType } from 'react';
import { Extension, type ChainedCommands, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import { pickAttachment } from './embeds';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import {
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Info,
  Paperclip,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table2,
  type LucideProps,
} from 'lucide-react';

export interface SlashItem {
  title: string;
  hint: string;
  keywords: string[];
  icon: ComponentType<LucideProps>;
  /** Change the current block. */
  run?: (chain: ChainedCommands) => ChainedCommands;
  /** Or do something after the `/query` text is gone (open the file picker). */
  action?: (editor: Editor) => void;
}

/** Every block the editor offers, in menu order. */
export const SLASH_ITEMS: SlashItem[] = [
  { title: 'Text', hint: 'Plain paragraph', keywords: ['paragraph', 'p'], icon: Pilcrow, run: (c) => c.setParagraph() },
  { title: 'Heading 1', hint: 'Big section title', keywords: ['h1', 'title'], icon: Heading1, run: (c) => c.setHeading({ level: 1 }) },
  { title: 'Heading 2', hint: 'Medium section title', keywords: ['h2', 'subtitle'], icon: Heading2, run: (c) => c.setHeading({ level: 2 }) },
  { title: 'Heading 3', hint: 'Small section title', keywords: ['h3'], icon: Heading3, run: (c) => c.setHeading({ level: 3 }) },
  { title: 'Bullet list', hint: 'A simple list', keywords: ['ul', 'unordered', 'bullets'], icon: List, run: (c) => c.toggleBulletList() },
  { title: 'Numbered list', hint: 'A list with numbers', keywords: ['ol', 'ordered'], icon: ListOrdered, run: (c) => c.toggleOrderedList() },
  { title: 'Task list', hint: 'Things to tick off', keywords: ['todo', 'checkbox', 'check'], icon: CheckSquare, run: (c) => c.toggleTaskList() },
  { title: 'Quote', hint: 'Set a passage apart', keywords: ['blockquote', 'citation'], icon: Quote, run: (c) => c.setBlockquote() },
  { title: 'Divider', hint: 'A quiet line between parts', keywords: ['hr', 'rule', 'separator', 'line'], icon: Minus, run: (c) => c.setHorizontalRule() },
  { title: 'Callout', hint: 'A highlighted note', keywords: ['note', 'info', 'tip', 'panel'], icon: Info, run: (c) => c.setCallout() },
  { title: 'Code block', hint: 'Code with highlighting', keywords: ['code', 'pre', 'snippet'], icon: Code2, run: (c) => c.setCodeBlock() },
  {
    title: 'Table',
    hint: '3 × 3 with a header row',
    keywords: ['grid', 'table'],
    icon: Table2,
    run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  {
    title: 'Image',
    hint: 'Upload a picture',
    keywords: ['picture', 'photo', 'img', 'upload'],
    icon: ImageIcon,
    action: (editor) => pickAttachment(editor, 'image'),
  },
  {
    title: 'File',
    hint: 'Attach a file to download',
    keywords: ['attachment', 'upload', 'pdf', 'document'],
    icon: Paperclip,
    action: (editor) => pickAttachment(editor, 'file'),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.startsWith(q)));
}

interface MenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}
export interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu({ items, command }, ref) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [items]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') {
        setActive((a) => (a + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setActive((a) => (a - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = items[active];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return (
      <div className="slash-menu" role="listbox" aria-label="Insert block">
        <p className="slash-empty">No matching blocks</p>
      </div>
    );
  }
  return (
    <div className="slash-menu" role="listbox" aria-label="Insert block" ref={list}>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={i === active}
            data-index={i}
            className="slash-item"
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(item)}
          >
            <span className="slash-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="slash-text">
              <span className="slash-title">{item.title}</span>
              <span className="slash-hint">{item.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});

function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  const gap = 6;
  const h = el.offsetHeight || 320;
  const below = rect.bottom + gap + h <= window.innerHeight;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${below ? rect.bottom + gap : Math.max(8, rect.top - gap - h)}px`;
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          const chain = editor.chain().focus().deleteRange(range);
          (props.run ? props.run(chain) : chain).run();
          props.action?.(editor);
        },
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let host: HTMLDivElement | null = null;
          let dismissed = false;
          const close = () => {
            renderer?.destroy();
            host?.remove();
            renderer = null;
            host = null;
          };
          return {
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
              dismissed = false;
              host = document.createElement('div');
              host.className = 'slash-host';
              document.body.appendChild(host);
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              host.appendChild(renderer.element);
              requestAnimationFrame(() => host && place(host, props.clientRect?.()));
            },
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
              if (dismissed || !renderer || !host) return;
              renderer.updateProps(props);
              place(host, props.clientRect?.());
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (dismissed || !renderer) return false;
              if (event.key === 'Escape') {
                dismissed = true;
                close();
                return true;
              }
              return renderer.ref?.onKeyDown(event) ?? false;
            },
            onExit: close,
          };
        },
      }),
    ];
  },
});
