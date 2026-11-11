// @mentions in the editor (docs/done-checks/15-mentions.md, 15b).
// Typing `@` (editors and up) opens a small list of the people who can read
// the space, from the same GET /api/spaces/:key/people the task picker uses.
// It narrows as you type; arrows, Enter or Tab pick, a click picks, Escape
// closes and leaves the `@` as plain text. Picking puts a mention chip in the
// text: an atom that keeps the person's id (the truth) and the name they had.
// A chip shows the person's current name; one whose person cannot read the
// space says "No access", an id that is nobody here says "Unknown person".
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Extension, type Editor, type NodeViewRenderer, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { SPACE_PEOPLE_LIMIT, type SpacePerson } from '@stillwater/shared';
import { api } from '../api';
import { NO_ACCESS } from '../tasks';

export const UNKNOWN_PERSON = 'Unknown person';

/**
 * What mention chips and the `@` list share with the page editor: the people
 * who can read the space (null while loading) and, only once a chip names
 * someone outside that list, the names of everyone active here (to tell
 * "No access" from "Unknown person"). Chips are plain DOM, so they listen
 * here for names arriving.
 */
export class MentionController {
  spaceKey = '';
  people: SpacePerson[] | null = null;
  private spaceNames: Map<string, string> | null = null;
  private allNames: Map<string, string> | null = null;
  private asked = false;
  /** Set by the page editor: load the directory of everyone active. */
  needDirectory: () => void = () => {};
  private listeners = new Set<() => void>();

  setPeople(people: SpacePerson[] | null) {
    this.people = people;
    this.spaceNames = people ? new Map(people.map((p) => [p.id.toLowerCase(), p.name])) : null;
    this.emit();
  }

  setDirectory(all: { id: string; name: string }[] | null) {
    this.allNames = all ? new Map(all.map((p) => [p.id.toLowerCase(), p.name])) : null;
    this.emit();
  }

  /** How a chip for this id reads right now. */
  resolve(userId: string, label: string): { name: string; status: 'ok' | 'loading' | 'no-access' | 'unknown' } {
    const id = userId.toLowerCase();
    if (this.spaceNames === null) return { name: label, status: 'loading' };
    const inSpace = this.spaceNames.get(id);
    if (inSpace !== undefined) return { name: inSpace, status: 'ok' };
    // The space list is capped; past the cap we cannot tell, so we say nothing.
    if (this.people && this.people.length >= SPACE_PEOPLE_LIMIT) return { name: label, status: 'loading' };
    if (this.allNames === null) {
      if (!this.asked) {
        this.asked = true;
        queueMicrotask(() => this.needDirectory());
      }
      return { name: label, status: 'loading' };
    }
    const anyone = this.allNames.get(id);
    return anyone !== undefined ? { name: anyone, status: 'no-access' } : { name: label, status: 'unknown' };
  }

  /** People for the `@` list: from the loaded list, or from the server past its cap. */
  async suggest(query: string): Promise<SpacePerson[]> {
    const q = query.trim().toLowerCase();
    if (!this.people) return [];
    if (this.people.length >= SPACE_PEOPLE_LIMIT && q && this.spaceKey) {
      try {
        return (await api.spacePeople(this.spaceKey, q)).people.slice(0, MAX_SHOWN);
      } catch {
        return [];
      }
    }
    return this.people.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

const MAX_SHOWN = 8;

/** The chip: `@Name`, and a quiet tag when the person cannot be told. */
export function mentionView(ctrl: MentionController): NodeViewRenderer {
  return ({ node: first }) => {
    let node = first;
    const dom = document.createElement('span');
    dom.className = 'mention';
    dom.contentEditable = 'false';
    dom.dataset.mention = '';
    const name = document.createElement('span');
    name.className = 'mention-name';
    const tag = document.createElement('span');
    tag.className = 'mention-tag';
    dom.append(name, tag);

    const render = () => {
      const userId = String(node.attrs.userId ?? '');
      const label = String(node.attrs.label ?? '');
      dom.dataset.userId = userId;
      const r = ctrl.resolve(userId, label);
      name.textContent = `@${r.name || label}`;
      const note = r.status === 'no-access' ? NO_ACCESS : r.status === 'unknown' ? UNKNOWN_PERSON : null;
      tag.hidden = note === null;
      tag.textContent = note ? ` · ${note}` : '';
      dom.dataset.status = r.status;
      dom.title =
        r.status === 'no-access'
          ? `${r.name} cannot open this space, so they are not told about this mention`
          : r.status === 'unknown'
            ? 'This mention names nobody who uses this wiki now'
            : '';
    };
    render();
    const unsubscribe = ctrl.subscribe(render);
    return {
      dom,
      update: (next) => {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      ignoreMutation: () => true,
      destroy: unsubscribe,
    };
  };
}

interface MenuProps {
  items: SpacePerson[];
  loading: boolean;
  command: (person: SpacePerson) => void;
}
interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const MentionMenu = forwardRef<MenuHandle, MenuProps>(function MentionMenu({ items, loading, command }, ref) {
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
        const person = items[active];
        if (person) command(person);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return (
      <div className="slash-menu mention-menu" role="listbox" aria-label="Mention someone">
        <p className="slash-empty">{loading ? 'Loading people…' : 'No one who can see this space by that name'}</p>
      </div>
    );
  }
  return (
    <div className="slash-menu mention-menu" role="listbox" aria-label="Mention someone" ref={list}>
      {items.map((p, i) => (
        <button
          key={p.id}
          type="button"
          role="option"
          aria-selected={i === active}
          data-index={i}
          className="slash-item mention-option"
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(p)}
        >
          {/* The letter is drawn by CSS (attr), so the row's text is just the name. */}
          <span className="mention-initial" aria-hidden="true" data-initial={(p.name.trim()[0] ?? '?').toUpperCase()} />
          <span className="slash-title">{p.name}</span>
        </button>
      ))}
    </div>
  );
});

function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  const gap = 6;
  const h = el.offsetHeight || 240;
  const below = rect.bottom + gap + h <= window.innerHeight;
  el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${below ? rect.bottom + gap : Math.max(8, rect.top - gap - h)}px`;
}

/** Puts a mention of `person` where `range` is, with one space after it. */
export function insertMention(editor: Editor, range: Range, person: SpacePerson) {
  const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 1, editor.state.doc.content.size), '\n', '\n');
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'mention', attrs: { userId: person.id, label: person.name } },
      ...(after.startsWith(' ') ? [] : [{ type: 'text', text: ' ' }]),
    ])
    .run();
}

const mentionKey = new PluginKey('mentionSuggest');

export const MentionSuggest = Extension.create<{ ctrl: MentionController | null }>({
  name: 'mentionSuggest',
  addOptions: () => ({ ctrl: null }),
  addProseMirrorPlugins() {
    const ctrl = this.options.ctrl;
    if (!ctrl) return [];
    return [
      Suggestion<SpacePerson, SpacePerson>({
        editor: this.editor,
        pluginKey: mentionKey,
        char: '@',
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        items: ({ query }) => ctrl.suggest(query),
        command: ({ editor, range, props }) => insertMention(editor, range, props),
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
          const menuProps = (props: SuggestionProps<SpacePerson, SpacePerson>): MenuProps => ({
            items: props.items,
            loading: ctrl.people === null,
            command: props.command,
          });
          return {
            onStart: (props) => {
              dismissed = false;
              host = document.createElement('div');
              host.className = 'slash-host';
              document.body.appendChild(host);
              renderer = new ReactRenderer(MentionMenu, { props: menuProps(props), editor: props.editor });
              host.appendChild(renderer.element);
              requestAnimationFrame(() => host && place(host, props.clientRect?.()));
            },
            onUpdate: (props) => {
              if (dismissed || !renderer || !host) return;
              renderer.updateProps(menuProps(props));
              place(host, props.clientRect?.());
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              if (dismissed || !renderer) return false;
              if (event.key === 'Escape') {
                // Close the list; the `@` (and anything typed after it) stays as text.
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
