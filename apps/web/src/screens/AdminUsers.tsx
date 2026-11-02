import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import type { Role, User } from '@stillwater/shared';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { ErrorNote, Field, Loading, Modal, RoleSelect } from '../ui';
import { NotFound } from './NotFound';

function NewUser({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const create = useMutation({
    mutationFn: () => api.createUser({ name, email, password, role }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal title="Add a person" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Starting password" hint="Share it with them privately. At least 8 characters.">
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Role">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        <ErrorNote error={create.error} />
        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Add person
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminUsers() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users, enabled: me.role === 'admin' });
  const [adding, setAdding] = useState(false);
  const update = useMutation({
    mutationFn: (v: { id: string; role?: Role; disabled?: boolean }) => api.updateUser(v.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  if (me.role !== 'admin') return <NotFound />;
  return (
    <main className="content content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">People</h1>
          <p className="muted">Admins manage everyone and every space. Editors can create spaces. Viewers only read.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <UserPlus size={16} aria-hidden="true" /> Add a person
        </button>
      </div>
      <ErrorNote error={users.error ?? update.error} />
      {users.isPending ? (
        <Loading />
      ) : (
        <ul className="member-list panel">
          {(users.data?.users ?? []).map((u: User) => (
            <li key={u.id} className={`member${u.disabled ? ' is-disabled' : ''}`}>
              <span className="avatar" aria-hidden="true">
                {u.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="grow">
                <span className="member-name">{u.name}</span>
                <span className="muted small"> {u.email}</span>
                {u.disabled && <span className="pill pill-muted">Disabled</span>}
              </span>
              <RoleSelect value={u.role} label={`Role for ${u.name}`} onChange={(role) => update.mutate({ id: u.id, role })} />
              {u.id !== me.id && (
                <button className="btn btn-quiet btn-sm" onClick={() => update.mutate({ id: u.id, disabled: !u.disabled })}>
                  {u.disabled ? 'Enable' : 'Disable'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <NewUser onClose={() => setAdding(false)} />}
    </main>
  );
}
