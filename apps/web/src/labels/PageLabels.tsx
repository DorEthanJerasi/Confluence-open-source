// The labels under a page's title (docs/done-checks/13-labels.md, 13b).
// Everyone who can open the page sees the chips; each one opens the space's
// "pages with this label" view. Editors and admins also get "Add label" (an
// input with suggestions from GET /api/labels) and a remove button per chip.
//
// Adding and removing show at once. The requests go out one after another,
// so quick changes land in order; if the server refuses one, that change is
// put back and a short quiet note says why. Labels sit beside the page, not
// in its document, so none of this goes through the page saver.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tag, X } from 'lucide-react';
import { LABEL_NAME_MESSAGE, normaliseLabel, type Label, type Page } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import { labelsKey, spaceLabelPath } from './labels';

/** How many suggestions show under the input. */
const SHOWN_SUGGESTIONS = 8;
/** A label added here keeps this id until the server gives it its own. */
const pendingId = (name: string) => `pending:${name}`;
const byName = (a: Label, b: Label) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function PageLabels({ page, spaceKey, canEdit }: { page: Page; spaceKey: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [labels, setLabels] = useState<Label[]>(page.labels);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  // The server's latest answer: the real ids, and what the chips settle on.
  const server = useRef<Label[]>(page.labels);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh copy of the page (another tab, a reload) shows its labels, unless a change is still on its way.
  useEffect(() => {
    if (inFlight.current > 0) return;
    server.current = page.labels;
    setLabels(page.labels);
  }, [page.labels]);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(t);
  }, [note]);

  /** Runs one change after the ones before it; `undo` puts the chips back if the server refuses. */
  function enqueue(send: () => Promise<{ labels: Label[] }>, onSaved: (saved: Label[]) => void, undo: (err: unknown) => void) {
    inFlight.current += 1;
    setNote(null);
    queue.current = queue.current.then(async () => {
      try {
        const reply = await send();
        server.current = reply.labels;
        qc.setQueryData<{ page: Page }>(['page', page.id], (old) => (old ? { page: { ...old.page, labels: reply.labels } } : old));
        onSaved(reply.labels);
      } catch (err) {
        undo(err);
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) {
          setLabels(server.current);
          void qc.invalidateQueries({ queryKey: labelsKey });
          void qc.invalidateQueries({ queryKey: ['search'] });
        }
      }
    });
  }

  const refusal = (err: unknown) =>
    err instanceof ApiFailure && err.status === 400 ? err.message : 'The server didn’t take the change. Try again in a moment.';

  /** Adds a name (already normalised). Returns false when there was nothing to add. */
  function add(name: string): boolean {
    if (labels.some((l) => l.name === name)) return false;
    setLabels((now) => [...now, { id: pendingId(name), name }].sort(byName));
    enqueue(
      () => api.addLabel(page.id, name),
      (saved) => {
        const real = saved.find((l) => l.name === name);
        setLabels((now) => now.map((l) => (l.id === pendingId(name) && real ? real : l)));
      },
      (err) => {
        setLabels((now) => now.filter((l) => l.id !== pendingId(name)));
        setNote(`“${name}” wasn’t added. ${refusal(err)}`);
      },
    );
    return true;
  }

  function remove(label: Label) {
    setLabels((now) => now.filter((l) => l.name !== label.name));
    enqueue(
      async () => {
        // A label added a moment ago has its real id by the time this runs (the queue keeps order).
        const id = server.current.find((l) => l.name === label.name)?.id;
        return id ? api.removeLabel(page.id, id) : { labels: server.current };
      },
      () => {},
      (err) => {
        setLabels((now) => (now.some((l) => l.name === label.name) ? now : [...now, label].sort(byName)));
        setNote(`“${label.name}” wasn’t removed. ${refusal(err)}`);
      },
    );
  }

  /** Focus after a chip is removed by keyboard: the chip before it, else the input or the Add button. */
  function focusAfterRemove(index: number) {
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.label-chip-remove');
      const before = buttons?.[Math.max(0, index - 1)];
      (before ?? inputRef.current ?? addRef.current)?.focus();
    });
  }

  function focusLastChip() {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.label-chip-remove');
    buttons?.[buttons.length - 1]?.focus();
  }

  if (!canEdit && labels.length === 0) return null;

  return (
    <div className="labels">
      {labels.length > 0 && (
        <ul className="label-list" aria-label="Labels" ref={listRef}>
          {labels.map((l, i) => (
            <li key={l.name} className={`label-chip${l.id.startsWith('pending:') ? ' is-pending' : ''}`}>
              <Link to={spaceLabelPath(spaceKey, l.name)} className="label-chip-link">
                <Tag size={12} aria-hidden="true" className="label-chip-icon" />
                {l.name}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  className="label-chip-remove"
                  aria-label={`Remove label ${l.name}`}
                  title={`Remove label ${l.name}`}
                  onClick={() => remove(l)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      e.preventDefault();
                      remove(l);
                      focusAfterRemove(i);
                    }
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <LabelInput
            inputRef={inputRef}
            onAdd={add}
            onBackspaceEmpty={focusLastChip}
            taken={labels.map((l) => l.name)}
            onClose={(refocus) => {
              setAdding(false);
              if (refocus) requestAnimationFrame(() => addRef.current?.focus());
            }}
          />
        ) : (
          <button type="button" ref={addRef} className="label-add" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden="true" /> Add label
          </button>
        ))}
      {note && (
        <p className="label-note fade-in" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The "Add label" input: shows the name as it will be stored while typing,
 * offers names already in use (Arrow keys and Enter, or a click), and adds
 * on Enter. Backspace on an empty input moves to the last chip; Escape, or
 * leaving it empty, closes it.
 */
function LabelInput(props: {
  inputRef: RefObject<HTMLInputElement>;
  taken: string[];
  onAdd: (name: string) => boolean;
  onBackspaceEmpty: () => void;
  onClose: (refocus: boolean) => void;
}) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState(false);
  const listId = useId();
  const hintId = useId();
  const name = normaliseLabel(value);
  const typed = value.trim() !== '';
  // Ask for names close to what is typed; while typing, the last list stays up.
  const prefix = name ?? '';
  const suggestions = useQuery({
    queryKey: [...labelsKey, 'suggest', prefix],
    queryFn: () => api.labelSuggestions(prefix),
    placeholderData: (previous) => previous,
  });
  const options = (suggestions.data?.labels ?? [])
    .filter((s) => !props.taken.includes(s.name) && (!prefix || s.name.includes(prefix)))
    .slice(0, SHOWN_SUGGESTIONS);
  // The list opens once something sensible is typed, or on Arrow Down; a refused name shows only its message.
  // Escape hides it until the next keystroke.
  const [browse, setBrowse] = useState(false);
  const [hidden, setHidden] = useState(false);
  const open = options.length > 0 && !hidden && (typed ? name !== null : browse);

  useEffect(() => props.inputRef.current?.focus(), [props.inputRef]);
  useEffect(() => setActive(-1), [prefix]);

  function commit(chosen: string | null) {
    if (!chosen) {
      if (typed) setProblem(true);
      return;
    }
    props.onAdd(chosen);
    setValue('');
    setProblem(false);
    setBrowse(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && !open && options.length > 0 && (!typed || name !== null)) {
      e.preventDefault();
      setBrowse(true);
      setHidden(false);
      setActive(0);
    } else if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(open && active >= 0 && options[active] ? options[active].name : name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (open) {
        setActive(-1);
        setBrowse(false);
        setHidden(true);
      } else props.onClose(true);
    } else if (e.key === 'Backspace' && value === '') {
      e.preventDefault();
      props.onBackspaceEmpty();
    }
  }

  const hint = !typed ? null : name === null ? LABEL_NAME_MESSAGE : name !== value.trim() ? `Adds as “${name}”` : null;

  return (
    <div className="label-input-wrap">
      <input
        ref={props.inputRef}
        className="label-input"
        role="combobox"
        aria-label="Add label"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={hint ? hintId : undefined}
        aria-invalid={problem && name === null ? true : undefined}
        placeholder="Label name"
        maxLength={60}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setProblem(false);
          setHidden(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => value.trim() === '' && props.onClose(false)}
      />
      {hint && (
        <p id={hintId} className={`label-hint${name === null ? ' is-bad' : ''}`} aria-live="polite">
          {hint}
        </p>
      )}
      <ul id={listId} role="listbox" aria-label="Label suggestions" className="label-suggestions" hidden={!open}>
        {options.map((s, i) => (
          <li
            key={s.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={`label-option${i === active ? ' is-active' : ''}`}
            // Keep focus in the input, so the list does not close before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(s.name)}
          >
            <span>{s.name}</span>
            <span className="label-option-count">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
