import { useState, type FormEvent } from 'react';
import { Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { roleAtLeast, type Role, type Visibility } from '@stillwater/shared';
import { api } from '../api';
import { ErrorNote, Field, Loading, Modal, ROLE_LABEL, RoleSelect } from '../ui';
import { TemplatesTab } from '../templates/TemplatesTab';
import { useSpace } from './Space';

function Details() {
  const { space } = useSpace();
  const qc = useQueryClient();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [visibility, setVisibility] = useState<Visibility>(space.visibility);
  const [defaultRole, setDefaultRole] = useState<Role>(space.defaultRole);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateSpace(space.key, { name, description, visibility, defaultRole }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['space', space.key] });
      await qc.invalidateQueries({ queryKey: ['spaces'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  };
  return (
    <section className="panel">
      <h2 className="section-title">Details</h2>
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
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
          <Field label="Everyone else gets" hint="Members below keep their own role.">
            <RoleSelect value={defaultRole} onChange={setDefaultRole} label="Default role" />
          </Field>
        )}
        <ErrorNote error={save.error} />
        <div className="row row-end">
          {saved && <span className="muted">Saved</span>}
          <button className="btn btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}

function Members({ canManage }: { canManage: boolean }) {
  const { space } = useSpace();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['members', space.key], queryFn: () => api.members(space.key) });
  const directory = useQuery({ queryKey: ['directory'], queryFn: api.directory, enabled: canManage });
  const [newUser, setNewUser] = useState('');
  const [newRole, setNewRole] = useState<Role>('editor');
  const refresh = () => qc.invalidateQueries({ queryKey: ['members', space.key] });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.setMember(space.key, v.userId, v.role),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (userId: string) => api.removeMember(space.key, userId), onSuccess: refresh });

  if (members.isPending) return <Loading />;
  const list = members.data?.members ?? [];
  const memberIds = new Set(list.map((m) => m.userId));
  const candidates = (directory.data?.users ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <section className="panel">
      <h2 className="section-title">Members</h2>
      <p className="muted">
        {space.visibility === 'restricted'
          ? 'Only these people can see this space (instance admins always can).'
          : `Everyone signed in can see this space as ${ROLE_LABEL[space.defaultRole].toLowerCase()}. Members get the role set here.`}
      </p>
      <ErrorNote error={members.error ?? setRole.error ?? remove.error} />
      <ul className="member-list">
        {list.map((m) => (
          <li key={m.userId} className="member">
            <span className="avatar" aria-hidden="true">
              {m.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="grow">
              <span className="member-name">{m.name}</span>
              <span className="muted small"> {m.email}</span>
            </span>
            {canManage ? (
              <>
                <RoleSelect
                  value={m.role}
                  label={`Role for ${m.name}`}
                  onChange={(role) => setRole.mutate({ userId: m.userId, role })}
                />
                <button className="icon-btn icon-btn-sm" aria-label={`Remove ${m.name}`} title="Remove" onClick={() => remove.mutate(m.userId)}>
                  <X size={15} />
                </button>
              </>
            ) : (
              <span className="pill">{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="row add-member"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newUser) return;
            setRole.mutate({ userId: newUser, role: newRole }, { onSuccess: () => setNewUser('') });
          }}
        >
          <select className="input grow" aria-label="Person to add" value={newUser} onChange={(e) => setNewUser(e.target.value)}>
            <option value="">Add a person…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <RoleSelect value={newRole} onChange={setNewRole} label="Role for new member" />
          <button className="btn btn-quiet" disabled={!newUser || setRole.isPending}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}

function DangerZone() {
  const { space } = useSpace();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const del = useMutation({
    mutationFn: () => api.deleteSpace(space.key),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['spaces'] });
      navigate('/', { replace: true });
    },
  });
  return (
    <section className="panel panel-danger">
      <h2 className="section-title">Delete this space</h2>
      <p className="muted">Removes the space and every page in it. This cannot be undone.</p>
      <div className="row">
        <button className="btn btn-danger" onClick={() => setAsking(true)}>
          Delete space
        </button>
      </div>
      {asking && (
        <Modal title="Delete space?" onClose={() => setAsking(false)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              del.mutate();
            }}
          >
            <Field label={`Type ${space.key} to confirm`}>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
            <ErrorNote error={del.error} />
            <div className="row row-end">
              <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" disabled={typed.trim().toLowerCase() !== space.key || del.isPending}>
                Delete for good
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

/** General and Templates; viewers get no tabs (they have no Templates tab). */
function SettingsTabs() {
  const { space, canEdit } = useSpace();
  if (!canEdit) return null;
  const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' is-on' : ''}`;
  return (
    <nav className="tabs" aria-label="Space settings">
      <NavLink end to={`/s/${space.key}/settings`} className={tab}>
        General
      </NavLink>
      <NavLink to={`/s/${space.key}/settings/templates`} className={tab}>
        Templates
      </NavLink>
    </nav>
  );
}

export function SpaceSettings() {
  const { space } = useSpace();
  const isAdmin = roleAtLeast(space.myRole, 'admin');
  return (
    <div className="content fade-in">
      <div className="page-head">
        <h1 className="page-title">Space settings</h1>
      </div>
      <SettingsTabs />
      <div className="stack stack-lg">
        {isAdmin && <Details key={space.id + space.name} />}
        <Members canManage={isAdmin} />
        {isAdmin && <DangerZone />}
      </div>
    </div>
  );
}

/** /s/:key/settings/templates: editors and up; anyone else goes back to the general tab. */
export function SpaceTemplatesSettings() {
  const { space, canEdit } = useSpace();
  if (!canEdit) return <Navigate to={`/s/${space.key}/settings`} replace />;
  return (
    <div className="content content-wide fade-in">
      <div className="page-head">
        <h1 className="page-title">Space settings</h1>
      </div>
      <SettingsTabs />
      <TemplatesTab spaceKey={space.key} />
    </div>
  );
}
