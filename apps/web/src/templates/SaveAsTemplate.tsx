// "Save as template" on a page (done-check 08, 8b): editors and up only.
// Stores the page's current content (after any pending autosave) as a new
// template of this space. A name clash shows the server's message here.
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX } from '@stillwater/shared';
import { api } from '../api';
import { ErrorNote, Field, Modal } from '../ui';
import { templatesKey } from './TemplatePicker';

export function SaveAsTemplateDialog(props: {
  spaceKey: string;
  pageId: string;
  pageTitle: string;
  /** Waits until what was typed is stored, so the template gets it. */
  beforeSave: () => Promise<void>;
  onSaved: (name: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(props.pageTitle);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await props.beforeSave();
      const { template } = await api.createTemplate(props.spaceKey, {
        name: name.trim(),
        description: description.trim(),
        fromPageId: props.pageId,
      });
      await qc.invalidateQueries({ queryKey: templatesKey(props.spaceKey) });
      props.onSaved(template.name);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title="Save as template" onClose={props.onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">New pages in this space can start from a copy of this page. Later edits to the page do not change the template.</p>
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={TEMPLATE_NAME_MAX}
          />
        </Field>
        <Field label="Short description" hint="Optional. Shown in the template picker.">
          <textarea
            className="input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={TEMPLATE_DESCRIPTION_MAX}
          />
        </Field>
        <ErrorNote error={error} />
        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            Save template
          </button>
        </div>
      </form>
    </Modal>
  );
}
