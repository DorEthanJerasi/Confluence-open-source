import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorNote, Field } from '../ui';
import { Logo } from './Shell';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const firstUser = config.data && !config.data.hasUsers;
  const canSignup = !!config.data && (config.data.allowSignup || firstUser);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === 'signup' ? await api.signup({ name, email, password }) : await api.login({ email, password });
      qc.setQueryData(['me'], res.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo />
          <span className="brand-name">Stillwater</span>
        </div>
        <h1 className="auth-title">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        {mode === 'signup' && firstUser && (
          <p className="note">You are the first person here, so this account will be the admin.</p>
        )}
        {mode === 'signup' && config.data && !canSignup ? (
          <p className="note">Sign-up is closed on this wiki. Ask an admin to create an account for you.</p>
        ) : (
          <form className="stack" onSubmit={submit}>
            {mode === 'signup' && (
              <Field label="Name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 8 : 1}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>
            <ErrorNote error={error} />
            <button className="btn btn-primary btn-block" disabled={busy}>
              {mode === 'signup' ? 'Create account' : 'Log in'}
            </button>
          </form>
        )}
        <p className="auth-switch muted">
          {mode === 'signup' ? (
            <>
              Already have an account? <Link to="/login">Log in</Link>
            </>
          ) : canSignup ? (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          ) : null}
        </p>
      </div>
    </main>
  );
}
