import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Moon, Sun, Users } from 'lucide-react';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { currentTheme, setTheme, type Theme } from '../theme';
import { ROLE_LABEL } from '../ui';

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" className="logo-bg" />
      <path d="M7 19c3-3 6-3 9 0s6 3 9 0" className="logo-wave" />
      <path d="M7 13c3-3 6-3 9 0s6 3 9 0" className="logo-wave logo-wave-soft" />
    </svg>
  );
}

function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(currentTheme());
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="icon-btn"
      onClick={() => {
        setTheme(next);
        setLocal(next);
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Shell() {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function logout() {
    await api.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(['me'], null);
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo />
          <span className="brand-name">Stillwater</span>
        </Link>
        <nav className="topnav">
          <NavLink to="/" end className="topnav-link">
            Spaces
          </NavLink>
          {user.role === 'admin' && (
            <NavLink to="/admin/users" className="topnav-link">
              <Users size={16} aria-hidden="true" /> People
            </NavLink>
          )}
        </nav>
        <div className="topbar-end">
          <ThemeToggle />
          <span className="who" title={user.email}>
            <span className="avatar" aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="who-name">{user.name}</span>
            <span className="pill">{ROLE_LABEL[user.role]}</span>
          </span>
          <button className="icon-btn" onClick={logout} aria-label="Log out" title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
