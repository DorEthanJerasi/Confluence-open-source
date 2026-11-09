import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, Plus } from 'lucide-react';
import { roleAtLeast, type Role, type Visibility } from '@stillwater/shared';
import { api, favouritesKey, recentKey } from '../api';
import { useCurrentUser } from '../auth';
import { exactTime, timeAgo } from '../time';
import { pageTitle } from '../tree';
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

/** Pages shown in each of the two personal lists on Home. */
const PERSONAL_SHOWN = 8;

type PersonalRow = { id: string; title: string; space: { key: string; name: string }; at: string };

/** One quiet list on Home: Favourites or Recently viewed (done-check 09, 9b). */
function PersonalList({
  id,
  title,
  rows,
  pending,
  error,
  emptyLine,
}: {
  id: string;
  title: string;
  rows: PersonalRow[] | undefined;
  pending: boolean;
  error: unknown;
  emptyLine: string;
}) {
  return (
    <section className="personal-list" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {pending ? (
        <p className="muted small">Loading…</p>
      ) : error ? (
        <ErrorNote error={error} />
      ) : !rows?.length ? (
        <p className="muted small">{emptyLine}</p>
      ) : (
        <ul className="list fade-in">
          {rows.slice(0, PERSONAL_SHOWN).map((r) => (
            <li key={r.id}>
              <Link to={`/s/${r.space.key}/p/${r.id}`} className="list-link personal-link">
                <FileText size={16} className="faint" aria-hidden="true" />
                <span className="grow personal-title">{pageTitle(r.title)}</span>
                <span className="muted small personal-meta">
                  {r.space.name} · <time dateTime={r.at} title={exactTime(r.at)}>{timeAgo(r.at)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Home() {
  const user = useCurrentUser();
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const [creating, setCreating] = useState(false);
  const canCreate = roleAtLeast(user.role, 'editor');
  // Refetched on every visit to Home, so a page starred a moment ago is there.
  const favourites = useQuery({ queryKey: favouritesKey, queryFn: api.favourites, refetchOnMount: 'always' });
  const recent = useQuery({ queryKey: recentKey, queryFn: api.recent, refetchOnMount: 'always' });

  return (
    <main className="content content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Home</h1>
          <p className="muted">Your pages, and every space you can see.</p>
        </div>
      </div>
      <div className="personal">
        <PersonalList
          id="home-favourites"
          title="Favourites"
          rows={favourites.data?.pages.map((p) => ({ ...p, at: p.favouritedAt }))}
          pending={favourites.isPending}
          error={favourites.error}
          emptyLine="Star a page to keep it here."
        />
        <PersonalList
          id="home-recent"
          title="Recently viewed"
          rows={recent.data?.pages.map((p) => ({ ...p, at: p.viewedAt }))}
          pending={recent.isPending}
          error={recent.error}
          emptyLine="Pages you open will show up here."
        />
      </div>
      <section aria-labelledby="home-spaces">
        <div className="page-head spaces-head">
          <div>
            <h2 className="section-title" id="home-spaces">
              Spaces
            </h2>
            <p className="muted small">Each space holds a tree of pages for one team or topic.</p>
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
      </section>
      {creating && <NewSpace onClose={() => setCreating(false)} />}
    </main>
  );
}
