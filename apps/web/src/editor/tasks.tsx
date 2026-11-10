// A task's person and due date in the editor (docs/done-checks/12-tasks.md, 12b).
// Each task row shows small chips after its text when a person or a date is
// set (viewers too, read-only). For editors, the row under the pointer or the
// caret shows "Assign" and "Due date"; Alt+Shift+A and Alt+Shift+D open them
// from the keyboard. Setting either is a normal edit of the task's attrs, so it
// autosaves and lands in history like any other change. The attrs live in the
// doc (the truth); this file only draws them and edits them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Extension, type Editor, type NodeViewRenderer } from '@tiptap/react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isCalendarDate, type SpacePerson } from '@stillwater/shared';
import { dueInfo, localToday, NO_ACCESS } from '../tasks';

export type TaskControl = 'assign' | 'due';

export interface TaskOpen {
  kind: TaskControl;
  /** Where the task is now (positions move as the doc changes). */
  getPos: () => number | undefined;
  /** The control it was opened from; the popover sits under it. */
  anchor: HTMLElement;
}

/**
 * What the task views share with the page editor: the names of the people
 * who can read the space (null while loading) and how to open a control.
 * Task views are plain DOM, so they listen here for names arriving.
 */
export class TaskController {
  names: Map<string, string> | null = null;
  open: (o: TaskOpen) => void = () => {};
  private listeners = new Set<() => void>();

  setPeople(people: SpacePerson[] | null) {
    this.names = people ? new Map(people.map((p) => [p.id, p.name])) : null;
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A chip: hidden words for screen readers ("Assigned to", "Due"), then what shows. */
function setChip(chip: HTMLElement, prefix: string, text: string | null, title = '') {
  chip.hidden = text === null;
  chip.replaceChildren(el('span', 'sr-only', `${prefix} `), document.createTextNode(text ?? ''));
  chip.title = title;
}

/** Sets attrs on the task at `pos` as one normal edit (autosave, history). */
export function setTaskAttrs(editor: Editor, pos: number | undefined, patch: { assignee?: string | null; due?: string | null }) {
  if (typeof pos !== 'number') return false;
  return editor
    .chain()
    .focus(undefined, { scrollIntoView: false })
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || node.type.name !== 'taskItem') return false;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
      return true;
    })
    .run();
}

/**
 * The task row: checkbox, the task's own content, then its chips and (for
 * editors) the two controls. The checkbox works as before: editors tick it,
 * viewers cannot.
 */
export function taskItemView(ctrl: TaskController): NodeViewRenderer {
  return ({ node: first, getPos, editor }) => {
    let node: PmNode = first;
    const editable = editor.isEditable;
    const li = el('li');
    li.dataset.type = 'taskItem';
    const label = el('label');
    label.contentEditable = 'false';
    const box = el('input');
    box.type = 'checkbox';
    label.append(box, el('span'));
    const content = el('div');
    const meta = el('span', 'task-meta');
    meta.contentEditable = 'false';
    const person = el('span', 'task-chip task-person');
    const due = el('span', 'task-chip task-due');
    meta.append(person, due);

    const pos = () => (typeof getPos === 'function' ? getPos() : undefined);
    if (editable) {
      const ctl = (kind: TaskControl, text: string, aria: string, keys: string) => {
        const b = el('button', 'task-ctl', text);
        b.type = 'button';
        b.setAttribute('aria-label', aria);
        b.setAttribute('aria-keyshortcuts', keys);
        b.title = `${aria} (${keys.replace(/\+/g, ' + ')})`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => ctrl.open({ kind, getPos: pos, anchor: b }));
        return b;
      };
      const ctls = el('span', 'task-ctls');
      ctls.append(
        ctl('assign', 'Assign', 'Assign this task to a person', 'Alt+Shift+A'),
        ctl('due', 'Due date', 'Set a due date for this task', 'Alt+Shift+D'),
      );
      meta.append(ctls);
    }

    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('change', () => {
      if (!editor.isEditable) {
        box.checked = !box.checked;
        return;
      }
      const checked = box.checked;
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .command(({ tr }) => {
          const at = pos();
          if (typeof at !== 'number') return false;
          const n = tr.doc.nodeAt(at);
          if (!n) return false;
          tr.setNodeMarkup(at, undefined, { ...n.attrs, checked });
          return true;
        })
        .run();
    });

    const render = () => {
      const a = node.attrs as { checked: boolean; taskId: string | null; assignee: string | null; due: string | null };
      li.dataset.checked = String(a.checked === true);
      for (const [k, v] of [
        ['taskId', a.taskId],
        ['assignee', a.assignee],
        ['due', a.due],
      ] as const) {
        if (v) li.dataset[k] = v;
        else delete li.dataset[k];
      }
      box.checked = a.checked === true;
      box.disabled = !editable;
      box.setAttribute('aria-label', `${a.checked ? 'Done' : 'Not done'}: ${node.firstChild?.textContent || 'empty task'}`);

      if (!a.assignee) setChip(person, 'Assigned to', null);
      else if (ctrl.names === null) setChip(person, 'Assigned to', null);
      else {
        const name = ctrl.names.get(a.assignee);
        setChip(person, 'Assigned to', name ?? NO_ACCESS, name ? '' : 'This person cannot open this space');
      }
      person.classList.toggle('is-no-access', !!a.assignee && ctrl.names !== null && !ctrl.names.has(a.assignee));

      if (a.due && isCalendarDate(a.due)) {
        const info = dueInfo(a.due, a.checked === true);
        setChip(due, 'Due', info.text, info.full);
        due.dataset.tone = info.tone;
      } else {
        setChip(due, 'Due', null);
        delete due.dataset.tone;
      }
      meta.classList.toggle('has-chips', !person.hidden || !due.hidden);
    };
    render();
    const unsubscribe = ctrl.subscribe(render);

    li.append(label, content, meta);
    return {
      dom: li,
      contentDOM: content,
      update: (next) => {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      // The chips and controls are drawn here, not by ProseMirror.
      ignoreMutation: (m) => m.type !== 'selection' && !content.contains(m.target),
      stopEvent: (e) => meta.contains(e.target as globalThis.Node),
      destroy: unsubscribe,
    };
  };
}

/** The innermost task around the caret: its position and node. */
function caretTask(state: EditorState): { pos: number; node: PmNode } | null {
  const $head = state.selection.$head;
  for (let d = $head.depth; d > 0; d--) {
    const n = $head.node(d);
    if (n.type.name === 'taskItem') return { pos: $head.before(d), node: n };
  }
  return null;
}

const caretKey = new PluginKey('taskCaret');

/**
 * Editors only: marks the task row with the caret (so its controls show), and
 * opens Assign (Alt+Shift+A) or Due date (Alt+Shift+D) for it.
 */
export const TaskCaret = Extension.create<{ ctrl: TaskController | null }>({
  name: 'taskCaret',
  addOptions: () => ({ ctrl: null }),
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: caretKey,
        props: {
          decorations: (state) => {
            const t = caretTask(state);
            if (!t) return null;
            return DecorationSet.create(state.doc, [Decoration.node(t.pos, t.pos + t.node.nodeSize, { class: 'has-caret' })]);
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    const open = (kind: TaskControl) => () => {
      const t = caretTask(this.editor.state);
      const ctrl = this.options.ctrl;
      if (!t || !ctrl) return false;
      const dom = this.editor.view.nodeDOM(t.pos) as HTMLElement | null;
      const anchor = dom?.querySelector<HTMLElement>(`:scope > .task-meta .task-ctl:nth-child(${kind === 'assign' ? 1 : 2})`);
      if (!anchor) return false;
      const at = t.pos;
      ctrl.open({ kind, getPos: () => at, anchor });
      return true;
    };
    return { 'Alt-Shift-a': open('assign'), 'Alt-Shift-d': open('due') };
  },
});

const POPOVER_WIDTH = 280;

/** Keeps the popover under its control, inside the window. */
function usePlace(anchor: HTMLElement) {
  const [place, setPlace] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const update = () => {
      const r = anchor.getBoundingClientRect();
      setPlace({ top: r.bottom + 6, left: Math.max(16, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 16)) });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);
  return place;
}

/** The Assign list or the Due date picker for one task, under its control. */
export function TaskPopover(props: { editor: Editor; open: TaskOpen; people: SpacePerson[] | null; onClose: () => void }) {
  const { editor, open, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const place = usePlace(open.anchor);
  const node = (() => {
    const p = open.getPos();
    const n = typeof p === 'number' ? editor.state.doc.nodeAt(p) : null;
    return n && n.type.name === 'taskItem' ? n : null;
  })();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (ref.current?.contains(t) || open.anchor.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open.anchor, onClose]);

  useEffect(() => {
    if (!node) onClose();
  }, [node, onClose]);
  if (!node) return null;

  const set = (patch: { assignee?: string | null; due?: string | null }) => {
    setTaskAttrs(editor, open.getPos(), patch);
    onClose();
  };
  const close = () => {
    onClose();
    editor.commands.focus(undefined, { scrollIntoView: false });
  };

  return createPortal(
    <div
      ref={ref}
      className="task-popover fade-in"
      role="dialog"
      aria-label={open.kind === 'assign' ? 'Assign task' : 'Due date'}
      style={{ top: place.top, left: place.left, width: POPOVER_WIDTH }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      {open.kind === 'assign' ? (
        <AssignList people={props.people} current={(node.attrs.assignee as string | null) ?? null} onPick={(id) => set({ assignee: id })} />
      ) : (
        <DuePicker current={(node.attrs.due as string | null) ?? null} onPick={(due) => set({ due })} />
      )}
    </div>,
    document.body,
  );
}

function AssignList(props: { people: SpacePerson[] | null; current: string | null; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const found = (props.people ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));
    const list: { id: string | null; label: string }[] = found.map((p) => ({ id: p.id, label: p.name }));
    if (props.current && !needle) list.unshift({ id: null, label: 'Nobody (remove the person)' });
    return list;
  }, [q, props.people, props.current]);
  useEffect(() => setActive(0), [q]);
  const listId = 'task-assign-list';

  return (
    <div className="task-assign">
      <input
        className="input input-compact"
        type="search"
        autoFocus
        placeholder="Find a person"
        aria-label="Find a person"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = options[active];
            if (o) props.onPick(o.id);
          }
        }}
      />
      {props.people === null ? (
        <p className="muted small task-popover-note">Loading people…</p>
      ) : options.length === 0 ? (
        <p className="muted small task-popover-note">No one here by that name.</p>
      ) : (
        <ul className="task-people" role="listbox" id={listId} aria-label="People who can open this space">
          {options.map((o, i) => (
            <li
              key={o.id ?? 'nobody'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`task-person-option${i === active ? ' is-active' : ''}${o.id === props.current ? ' is-current' : ''}${o.id === null ? ' is-clear' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => props.onPick(o.id)}
            >
              {o.label}
              {o.id !== null && o.id === props.current && <span className="sr-only"> (assigned now)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DuePicker(props: { current: string | null; onPick: (due: string | null) => void }) {
  const [value, setValue] = useState(props.current ?? localToday());
  const ok = isCalendarDate(value);
  return (
    <form
      className="task-due-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) props.onPick(value);
      }}
    >
      <label className="field">
        <span className="field-label">Due date</span>
        <input className="input input-compact" type="date" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="row row-end">
        {props.current && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => props.onPick(null)}>
            Clear date
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!ok}>
          Set date
        </button>
      </div>
    </form>
  );
}
