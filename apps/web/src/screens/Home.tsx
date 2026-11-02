import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import { roleAtLeast, type Role, type Visibility } from '@stillwater/shared';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { ErrorNote, Field, Loading, Modal, ROLE_LABEL, RoleSelect } from '../ui';

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function NewSpace({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('open');
  const [defaultRole, setDefaultRole] = useState<Role>('viewer');
  const create = useMutation({
    mutationFn: () => api.createSpace({ name, key: keyTouched ? key : slugify(name), description, visibility, defaultRole }),
    onSuccess: async ({ space }) => {
      await qc.invalidateQueries({ queryKey: ['spaces'] });
      navigate(`/s/${space.key}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal title="New space" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="Short key" hint="Used in links. Letters, numbers and dashes.">
          <input
            className="input"
            value={keyTouched ? key : slugify(name)}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
            required
            maxLength={32}
          />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Who can see it">
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="open">Everyone signed in</option>
            <option value="restricted">Only members</option>
          </select>
        </Field>
        {visibility === 'open' && (
          <Field label="Everyone else gets">
            <RoleSelect value={defaultRole} onChange={setDefaultRole} label="Default role" />
          </Field>
        )}
        <ErrorNote error={create.error} />
        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Create space
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Home() {
  const user = useCurrentUser();
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const [creating, setCreating] = useState(false);
  const canCreate = roleAtLeast(user.role, 'editor');

  return (
    <main className="content content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Spaces</h1>
          <p className="muted">Each space holds a tree of pages for one team or topic.</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> New space
          </button>
        )}
      </div>
      {spaces.isPending ? (
        <Loading />
      ) : spaces.error ? (
        <ErrorNote error={spaces.error} />
      ) : spaces.data.spaces.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No spaces yet</p>
          <p className="muted">
            {canCreate ? 'Create the first one to start writing.' : 'Ask an editor or admin to create one.'}
          </p>
        </div>
      ) : (
        <ul className="cards">
          {spaces.data.spaces.map((s) => (
            <li key={s.id}>
              <Link to={`/s/${s.key}`} className="card card-link">
                <div className="card-head">
                  <span className="space-mark" aria-hidden="true">
                    {s.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="card-title">{s.name}</span>
                  {s.visibility === 'restricted' && <Lock size={14} className="faint" aria-label="Members only" />}
                </div>
                {s.description && <p className="card-text muted">{s.description}</p>}
                <span className="pill">{ROLE_LABEL[s.myRole]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewSpace onClose={() => setCreating(false)} />}
    </main>
  );
}
