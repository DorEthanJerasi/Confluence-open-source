// The Templates tab in space settings (done-check 08, 8b), for editors and up.
// Built-ins can only be previewed; the space's own templates can be edited in
// the same block editor as pages (Save button, no autosave) and deleted.
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import { TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX, type Doc, type TemplateSummary } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import { timeAgo } from '../time';
import { ErrorNote, Field, Loading, Modal } from '../ui';
import { TemplateBody, templateKey, templatesKey } from './TemplatePicker';

const TemplateBodyEditor = lazy(() => import('./TemplateDoc').then((m) => ({ default: m.TemplateBodyEditor })));

const EMPTY_DOC: Doc = { type: 'doc', content: [{ type: 'paragraph' }] };

export function TemplatesTab({ spaceKey }: { spaceKey: string }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: templatesKey(spaceKey), queryFn: () => api.templates(spaceKey) });
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [previewing, setPreviewing] = useState<TemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(spaceKey, id),
    onSuccess: async (_d, id) => {
      setDeleting(null);
      qc.removeQueries({ queryKey: templateKey(spaceKey, id) });
      await qc.invalidateQueries({ queryKey: templatesKey(spaceKey) });
    },
  });

  if (editing) {
    return <TemplateEditorView key={editing.id ?? 'new'} spaceKey={spaceKey} id={editing.id} onDone={() => setEditing(null)} />;
  }

  const templates = list.data?.templates ?? [];
  const builtIns = templates.filter((t) => t.builtIn);
  const own = templates.filter((t) => !t.builtIn);

  const row = (t: TemplateSummary) => (
    <li key={t.id} className="template-row">
      <span className="template-row-icon" aria-hidden="true">
        <LayoutTemplate size={16} />
      </span>
      <span className="grow template-row-text">
        <span className="template-row-name">
          {t.name}
          {t.builtIn && <span className="pill pill-muted">Built in</span>}
        </span>
        {t.description && <span className="muted small">{t.description}</span>}
        {!t.builtIn && t.updatedAt && (
          <span className="muted small">
            {t.updatedBy ? `Edited by ${t.updatedBy.name} · ` : ''}
            {timeAgo(t.updatedAt)}
          </span>
        )}
      </span>
      {t.builtIn ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPreviewing(t)} aria-label={`Preview ${t.name}`}>
          Preview
        </button>
      ) : (
        <span className="row">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing({ id: t.id })} aria-label={`Edit ${t.name}`}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`}>
            <Trash2 size={14} aria-hidden="true" /> Delete
          </button>
        </span>
      )}
    </li>
  );

  return (
    <section className="panel" aria-label="Templates">
      <div className="row template-tab-head">
        <div className="grow">
          <h2 className="section-title">Templates</h2>
          <p className="muted">New pages in this space can start from one of these. Changing a template never changes pages already made from it.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null })}>
          <Plus size={16} aria-hidden="true" /> New template
        </button>
      </div>
      <ErrorNote error={list.error ?? del.error} />
      {list.isPending ? (
        <Loading />
      ) : (
        <>
          <h3 className="template-group">This space</h3>
          {own.length === 0 ? (
            <p className="muted small">No templates of your own yet. Make one here, or use “Save as template” on a page.</p>
          ) : (
            <ul className="template-list">{own.map(row)}</ul>
          )}
          <h3 className="template-group">Built in</h3>
          <ul className="template-list">{builtIns.map(row)}</ul>
        </>
      )}

      {previewing && (
        <Modal title={previewing.name} onClose={() => setPreviewing(null)} className="modal-wide">
          {previewing.description && <p className="muted">{previewing.description}</p>}
          <div className="picker-preview-body template-preview-modal">
            <TemplateBody spaceKey={spaceKey} id={previewing.id} name={previewing.name} />
          </div>
          <div className="row row-end">
            <button type="button" className="btn btn-quiet" onClick={() => setPreviewing(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal title={`Delete “${deleting.name}”?`} onClose={() => setDeleting(null)}>
          <p className="muted">It is removed from the picker. Pages already made from it stay as they are.</p>
          <ErrorNote error={del.error} />
          <div className="row row-end">
            <button type="button" className="btn btn-quiet" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate(deleting.id)}>
              Delete template
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** One template's name, description and body, saved with the Save button. `id` null = a new template. */
function TemplateEditorView({ spaceKey, id: startId, onDone }: { spaceKey: string; id: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState(startId);
  const q = useQuery({
    queryKey: templateKey(spaceKey, id ?? 'new'),
    queryFn: () => api.template(spaceKey, id!),
    enabled: id !== null,
    staleTime: 0,
  });
  // What the editor started from; a reload replaces it (and makes a fresh editor).
  const [base, setBase] = useState<{ version: number; doc: Doc; name: string; description: string } | null>(
    startId === null ? { version: 0, doc: EMPTY_DOC, name: '', description: '' } : null,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const doc = useRef<Doc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  // Fill the form once the template is loaded (first open, or after Reload).
  useEffect(() => {
    if (base || !q.data) return;
    const t = q.data.template;
    setBase({ version: t.version, doc: t.doc, name: t.name, description: t.description });
    setName(t.name);
    setDescription(t.description);
    doc.current = null;
    setDirty(false);
  }, [q.data, base]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function reload() {
    if (id === null) return;
    try {
      await qc.fetchQuery({ queryKey: templateKey(spaceKey, id), queryFn: () => api.template(spaceKey, id), staleTime: 0 });
    } catch (err) {
      setError(err);
      return;
    }
    setConflict(false);
    setError(null);
    setBase(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!base) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = { name: name.trim(), description: description.trim(), doc: doc.current ?? base.doc };
      const { template } =
        id === null
          ? await api.createTemplate(spaceKey, body)
          : await api.updateTemplate(spaceKey, id, { baseVersion: base.version, ...body });
      // Keep the editor as it is; only the version (and id, for a new one) move on.
      setBase((b) => (b ? { ...b, version: template.version, name: template.name, description: template.description } : b));
      if (id === null) setId(template.id);
      qc.setQueryData(templateKey(spaceKey, template.id), { template });
      await qc.invalidateQueries({ queryKey: templatesKey(spaceKey) });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 409 && err.code === 'stale_version') setConflict(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (id !== null && q.error) return <ErrorNote error={q.error} />;
  if (!base) return <Loading />;

  const changed = () => {
    setDirty(true);
    setSaved(false);
  };

  return (
    <section className="panel template-editor fade-in" aria-label={id === null ? 'New template' : `Edit template ${base.name}`}>
      <form className="stack" onSubmit={save}>
        <h2 className="section-title">{id === null ? 'New template' : 'Edit template'}</h2>
        <Field label="Name">
          <input
            className="input"
            value={name}
            required
            maxLength={TEMPLATE_NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              changed();
            }}
          />
        </Field>
        <Field label="Short description" hint="Optional. Shown in the template picker.">
          <textarea
            className="input"
            rows={2}
            value={description}
            maxLength={TEMPLATE_DESCRIPTION_MAX}
            onChange={(e) => {
              setDescription(e.target.value);
              changed();
            }}
          />
        </Field>
        <div className="field">
          <span className="field-label">Content</span>
          <div className="template-editor-body">
            <Suspense fallback={<Loading />}>
              <TemplateBodyEditor
                doc={base.doc}
                onChange={(d) => {
                  doc.current = d;
                  changed();
                }}
              />
            </Suspense>
          </div>
        </div>
        {conflict && (
          <div className="conflict-note fade-in" role="alert">
            <p>
              <strong>This template was changed somewhere else</strong> since you opened it. Your changes are still here and
              have not been saved. Reload to get the latest version; your changes here will be replaced.
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void reload()}>
                Reload
              </button>
            </div>
          </div>
        )}
        <ErrorNote error={error} />
        <div className="row row-end">
          {saved && (
            <span className="muted" role="status">
              Saved
            </span>
          )}
          <button type="button" className="btn btn-quiet" onClick={onDone}>
            {dirty ? 'Discard changes' : 'Back to templates'}
          </button>
          <button className="btn btn-primary" disabled={busy || conflict || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
