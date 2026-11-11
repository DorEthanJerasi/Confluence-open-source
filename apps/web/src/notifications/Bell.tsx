import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import type { Notification } from '@stillwater/shared';
import { api, unreadKey } from '../api';
import { exactTime, timeAgo } from '../time';
import { pageTitle } from '../tree';
import { ErrorNote } from '../ui';

/** What the badge shows: nothing at 0, the number up to nine, then "9+". */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** The bell's name for screen readers, e.g. "3 unread notifications". */
export function bellLabel(count: number): string {
  if (count <= 0) return 'Notifications, none unread';
  return `${count} unread notification${count === 1 ? '' : 's'}`;
}

/** One line in plain words, e.g. "Ana mentioned you on Pruning guide". */
function sentence(n: Notification) {
  const who = n.actor?.name ?? 'Someone';
  const title = <strong className="notice-page">{pageTitle(n.page.title)}</strong>;
  if (n.kind === 'mention') return <>{who} mentioned you on {title}</>;
  if (n.kind === 'comment') return <>{who} commented on {title}</>;
  // Edits fold while unread; the server keeps the newest editor and how many saves.
  return (
    <>
      {who} edited {title}
      {n.count > 1 && <span className="notice-count"> ({n.count} changes)</span>}
    </>
  );
}

/** Where a notification leads: the page, and for a comment the comments panel on that comment. */
function target(n: Notification) {
  const page = `/s/${encodeURIComponent(n.page.space.key)}/p/${n.page.id}`;
  return n.kind === 'comment' && n.commentId ? `${page}?comment=${n.commentId}` : page;
}

/**
 * The bell in the top bar (done-check 15, 15b). The unread count is asked for
 * when the app opens, every 60 s while the tab is visible, on window focus and
 * after the list is opened; there is no live push. The panel reloads from the
 * top each time it opens, so an edit that folded in (and moved forward in
 * time) is never missed by paging.
 */
export function NotificationBell() {
  const qc = useQueryClient();
  const unread = useQuery({
    queryKey: unreadKey,
    queryFn: api.unreadCount,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const count = unread.data?.count ?? 0;
  const badge = badgeText(count);

  // Switching back from another app fires `focus` without a visibility change.
  useEffect(() => {
    const onFocus = () => void qc.invalidateQueries({ queryKey: unreadKey });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [qc]);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [marking, setMarking] = useState(false);
  const run = useRef(0);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const mine = ++run.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setMore(false);
    try {
      const list = await api.notifications();
      if (mine !== run.current) return;
      setItems(list.notifications);
      setMore(list.more);
    } catch (err) {
      if (mine === run.current) setError(err);
    } finally {
      if (mine === run.current) setLoading(false);
      void qc.invalidateQueries({ queryKey: unreadKey });
    }
  }, [qc]);

  async function showMore() {
    const last = items[items.length - 1];
    if (!last || loadingMore) return;
    const mine = run.current;
    setLoadingMore(true);
    setError(null);
    try {
      const list = await api.notifications(last.id);
      if (mine !== run.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...list.notifications.filter((n) => !seen.has(n.id))];
      });
      setMore(list.more);
    } catch (err) {
      if (mine === run.current) setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const close = useCallback((refocus: boolean) => {
    run.current++;
    setOpen(false);
    if (refocus) bellRef.current?.focus();
  }, []);

  function toggle() {
    if (open) return close(false);
    setOpen(true);
    void load();
  }

  // Focus moves into the panel when it opens, so Tab walks the list.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // A click anywhere else closes it (focus stays where the click put it).
  // Escape closes it wherever focus is (a button that just went away leaves
  // focus on the page), and only it: a comments panel under it stays open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || bellRef.current?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  function opened(n: Notification) {
    close(false);
    if (n.readAt) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    api
      .markRead({ ids: [n.id] })
      .then((r) => qc.setQueryData(unreadKey, r))
      .catch(() => void qc.invalidateQueries({ queryKey: unreadKey }));
  }

  async function markAll() {
    setMarking(true);
    setError(null);
    try {
      const r = await api.markRead({ all: true });
      qc.setQueryData(unreadKey, r);
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    } catch (err) {
      setError(err);
    } finally {
      setMarking(false);
      // The button goes away once nothing is unread; keep focus in the list.
      panelRef.current?.focus();
    }
  }

  const anyUnread = count > 0 || items.some((n) => !n.readAt);

  return (
    <div className="bell">
      <button
        ref={bellRef}
        className={`icon-btn bell-btn${open ? ' is-on' : ''}`}
        onClick={toggle}
        aria-label={bellLabel(count)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'notice-panel' : undefined}
        title="Notifications"
      >
        <Bell size={18} aria-hidden="true" />
        {badge && (
          <span className="bell-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          id="notice-panel"
          ref={panelRef}
          className="notice-panel"
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
        >
          <div className="notice-head">
            <h2 className="notice-title">Notifications</h2>
            {anyUnread && (
              <button className="btn btn-quiet btn-sm" onClick={markAll} disabled={marking || loading}>
                <Check size={14} aria-hidden="true" /> Mark all as read
              </button>
            )}
          </div>
          <ErrorNote error={error} />
          {loading ? (
            <p className="notice-empty muted" role="status">
              Loading…
            </p>
          ) : items.length === 0 && !error ? (
            <p className="notice-empty muted">
              Nothing here yet. When someone mentions you, or comments on or edits a page you follow, it shows up here.
            </p>
          ) : (
            <ul className="notice-list">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    to={target(n)}
                    className={`notice${n.readAt ? '' : ' is-unread'}`}
                    onClick={() => opened(n)}
                  >
                    <span className="notice-dot" aria-hidden="true" />
                    <span className="notice-text">
                      {!n.readAt && <span className="sr-only">Unread: </span>}
                      <span className="notice-line">{sentence(n)}</span>
                      <span className="notice-meta">
                        {n.page.space.name} · <time dateTime={n.createdAt} title={exactTime(n.createdAt)}>{timeAgo(n.createdAt)}</time>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {more && !loading && (
            <button className="btn btn-quiet btn-sm notice-more" onClick={showMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
