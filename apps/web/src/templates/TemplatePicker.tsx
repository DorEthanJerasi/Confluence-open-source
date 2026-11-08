// The quiet picker every "New page" and "Add a sub-page" control opens
// (done-check 08, 8b): "Blank page" first and focused, then the built-ins,
// then this space's templates. Choosing one previews it; "Use template",
// Enter or a double-click makes the page. Escape closes and makes nothing.
import { lazy, Suspense, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, LayoutTemplate } from 'lucide-react';
import type { TemplateSummary } from '@stillwater/shared';
import { api } from '../api';
import { ErrorNote, Loading, Modal } from '../ui';

export const TemplatePreview = lazy(() => import('./TemplateDoc').then((m) => ({ default: m.TemplatePreview })));

export const templatesKey = (spaceKey: string) => ['templates', spaceKey] as const;
export const templateKey = (spaceKey: string, id: string) => ['template', spaceKey, id] as const;

const BLANK = '';

/** The read-only body of one template, fetched when it is chosen. */
export function TemplateBody({ spaceKey, id, name }: { spaceKey: string; id: string; name: string }) {
  const q = useQuery({ queryKey: templateKey(spaceKey, id), queryFn: () => api.template(spaceKey, id) });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <Suspense fallback={<Loading />}>
      <TemplatePreview doc={q.data.template.doc} label={`Preview of ${name}`} />
    </Suspense>
  );
}

export function TemplatePicker(props: {
  spaceKey: string;
  /** Title of the page the new one goes under, if any. */
  parentTitle?: string | null;
  /** Makes the page (null = blank). The picker shows the error if it fails. */
  onCreate: (templateId: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const list = useQuery({ queryKey: templatesKey(props.spaceKey), queryFn: () => api.templates(props.spaceKey) });
  const [chosen, setChosen] = useState<string>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const templates = list.data?.templates ?? [];
  const options: (TemplateSummary | null)[] = [null, ...templates];
  const current = templates.find((t) => t.id === chosen) ?? null;

  async function use(id: string = chosen) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreate(id === BLANK ? null : id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  // Arrow keys move through the list (and preview); Enter uses the chosen one.
  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const at = options.findIndex((o) => (o?.id ?? BLANK) === chosen);
    let next = at;
    if (e.key === 'ArrowDown') next = Math.min(options.length - 1, at + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else if (e.key === 'Enter') {
      e.preventDefault();
      void use();
      return;
    } else return;
    e.preventDefault();
    const id = options[next]?.id ?? BLANK;
    setChosen(id);
    e.currentTarget.querySelector<HTMLElement>(`[data-option="${CSS.escape(id || 'blank')}"]`)?.focus();
  }

  const option = (t: TemplateSummary | null) => {
    const id = t?.id ?? BLANK;
    const on = id === chosen;
    return (
      <li key={id || 'blank'} role="presentation">
        <button
          type="button"
          role="option"
          aria-selected={on}
          tabIndex={on ? 0 : -1}
          data-option={id || 'blank'}
          data-autofocus={id === BLANK ? '' : undefined}
          className={`picker-option${on ? ' is-on' : ''}`}
          onClick={() => setChosen(id)}
          onDoubleClick={() => void use(id)}
        >
          <span className="picker-option-icon" aria-hidden="true">
            {t ? <LayoutTemplate size={16} /> : <FilePlus2 size={16} />}
          </span>
          <span className="picker-option-text">
            <span className="picker-option-name">
              {t ? t.name : 'Blank page'}
              {t?.builtIn && <span className="pill pill-muted">Built in</span>}
            </span>
            <span className="picker-option-desc">{t ? t.description : 'Start from an empty page.'}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Modal title="New page" onClose={props.onClose} className="modal-wide">
      {props.parentTitle && <p className="muted picker-under">Under “{props.parentTitle}”</p>}
      <div className="picker">
        <ul className="picker-list" role="listbox" aria-label="Start from" onKeyDown={onListKey}>
          {option(null)}
          {templates.map(option)}
          {list.isPending && (
            <li role="presentation">
              <Loading />
            </li>
          )}
        </ul>
        <section className="picker-preview" aria-label="Preview">
          {current ? (
            <>
              <p className="picker-preview-name">{current.name}</p>
              {current.description && <p className="muted small">{current.description}</p>}
              <div className="picker-preview-body" key={current.id}>
                <TemplateBody spaceKey={props.spaceKey} id={current.id} name={current.name} />
              </div>
            </>
          ) : (
            <div className="picker-preview-blank">
              <p className="muted">An empty page, ready for you to write in.</p>
            </div>
          )}
        </section>
      </div>
      <ErrorNote error={error ?? list.error} />
      <div className="row row-end">
        <button type="button" className="btn btn-quiet" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void use()}>
          {current ? 'Use template' : 'Create page'}
        </button>
      </div>
    </Modal>
  );
}
