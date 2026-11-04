import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, MessageCircleQuestion, Moon, Search, Sun, Users } from 'lucide-react';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { currentTheme, setTheme, type Theme } from '../theme';
import { ROLE_LABEL } from '../ui';
import { useAiEnabled } from '../ai/SummaryCard';

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

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The search field in the top bar. Ctrl+K (⌘K on a Mac) focuses it from
 * anywhere, the editor included; `/` is left to the editor's slash menu.
 * Enter opens /search?q=…, so the query lives in the URL.
 */
function SearchField() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const urlQuery = location.pathname === '/search' ? (params.get('q') ?? '') : '';
  const [value, setValue] = useState(urlQuery);
  const ref = useRef<HTMLInputElement>(null);

  // Keep the field in step with the URL (reload, back and forward).
  useEffect(() => setValue(urlQuery), [urlQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    // Capture phase, so the editor never swallows the shortcut first.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <form
      className="topsearch"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search size={16} className="topsearch-icon" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        className="topsearch-input"
        placeholder="Search pages"
        aria-label="Search pages"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
      />
      <kbd className="topsearch-kbd" aria-hidden="true">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </form>
  );
}

export function Shell() {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const aiOn = useAiEnabled();

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
        <SearchField />
        {aiOn && (
          <NavLink to="/ask" className="topnav-link topbar-ask">
            <MessageCircleQuestion size={16} aria-hidden="true" /> Ask
          </NavLink>
        )}
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
