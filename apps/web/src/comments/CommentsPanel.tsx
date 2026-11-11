// Page comments on screen (docs/done-checks/07-comments.md, 7b): the side
// panel with open threads (newest first), the resolved ones folded away, and
// composers for the whole page, for one block, and for replies. Controls
// follow the role table; a control the user cannot use is not shown.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import {
  COMMENT_MAX_LENGTH,
  roleAtLeast,
  type CommentReply,
  type CommentThread,
  type Page,
  type Role,
} from '@stillwater/shared';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { exactTime, timeAgo } from '../time';
import { ErrorNote, Loading } from '../ui';
import { blockQuote, commentsKey } from './blocks';

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={exactTime(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A text box that sends with Ctrl+Enter / ⌘Enter. Empty text cannot be sent. */
function Composer({
  label,
  placeholder,
  submitLabel,
  initial = '',
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  /** Resolves when stored; the box empties. Throws to keep the text. */
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim().length === 0;

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  async function send() {
    if (empty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="comment-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={ref}
        className="input comment-input"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        rows={2}
        maxLength={COMMENT_MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === 'Escape' && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <ErrorNote error={error} />
      <div className="comment-composer-bar">
        <span className="faint comment-hint">{isMac ? '⌘' : 'Ctrl'} + Enter to send</span>
        {onCancel && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={empty || busy}>
          {busy ? 'Sending…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

type Rights = { me: string; canResolve: boolean; canAdmin: boolean };

/** One comment (a root or a reply): who, when, the text as plain text, and its own Edit / Delete. */
function CommentBody({
  c,
  rights,
  deleted = false,
  onChanged,
  children,
}: {
  c: CommentReply;
  rights: Rights;
  deleted?: boolean;
  onChanged: () => Promise<void>;
  /** Extra controls for the thread (Reply, Resolve), shown in the same row. */
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mine = !deleted && !!c.author && c.author.id === rights.me;
  const canDelete = !deleted && (mine || rights.canAdmin);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteComment(c.id);
      await onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <div className="comment" data-comment-id={c.id}>
      {deleted ? (
        <p className="comment-deleted muted">Comment deleted</p>
      ) : (
        <>
          <p className="comment-meta">
            <span className="comment-author">{c.author?.name ?? 'Removed user'}</span>
            <span className="comment-when muted">
              <When iso={c.createdAt} />
              {c.editedAt && (
                <span className="comment-edited" title={`Edited ${exactTime(c.editedAt)}`}>
                  {' '}
                  · edited
                </span>
              )}
            </span>
          </p>
          {editing ? (
            <Composer
              label="Edit comment"
              placeholder="Comment"
              submitLabel="Save"
              initial={c.body}
              autoFocus
              onSubmit={async (body) => {
                await api.editComment(c.id, body);
                await onChanged();
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <p className="comment-text">{c.body}</p>
          )}
        </>
      )}
      <ErrorNote error={error} />
      {asking ? (
        <div className="comment-confirm fade-in" role="group" aria-label="Delete this comment?">
          <span className="muted">Delete this comment?</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsking(false)} disabled={busy}>
            Keep
          </button>
          <button type="button" className="btn btn-quiet btn-sm comment-danger" onClick={remove} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ) : (
        !editing &&
        (children || mine || canDelete) && (
          <div className="comment-actions">
            {children}
            {mine && (
              <button type="button" className="comment-action" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {canDelete && (
              <button type="button" className="comment-action" onClick={() => setAsking(true)}>
                Delete
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}

function Thread({
  t,
  page,
  rights,
  highlighted,
  onJump,
  onChanged,
}: {
  t: CommentThread;
  page: Page;
  rights: Rights;
  highlighted: boolean;
  onJump: (blockId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const quote = t.blockId && !t.blockMissing ? blockQuote(page.doc, t.blockId) : null;

  async function toggleResolved() {
    setBusy(true);
    setError(null);
    try {
      await (t.resolvedAt ? api.reopenComment(t.id) : api.resolveComment(t.id));
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`comment-thread${highlighted ? ' is-highlighted' : ''}${t.resolvedAt ? ' is-resolved' : ''}`}
      data-thread-id={t.id}
      aria-label={t.blockId ? 'Thread on a block' : 'Thread on the page'}
    >
      {t.blockId &&
        (t.blockMissing ? (
          <p className="comment-anchor faint">On a removed block</p>
        ) : (
          <button type="button" className="comment-anchor comment-quote" onClick={() => onJump(t.blockId!)} title="Go to this block">
            {quote ?? 'A block on this page'}
          </button>
        ))}
      <CommentBody c={t} rights={rights} deleted={t.deleted} onChanged={onChanged}>
        <button type="button" className="comment-action" onClick={() => setReplying(true)}>
          Reply
        </button>
        {rights.canResolve && (
          <button type="button" className="comment-action" onClick={toggleResolved} disabled={busy}>
            {t.resolvedAt ? 'Reopen' : 'Resolve'}
          </button>
        )}
      </CommentBody>
      <ErrorNote error={error} />
      {t.resolvedAt && (
        <p className="comment-resolved faint">
          Resolved{t.resolvedBy ? ` by ${t.resolvedBy.name}` : ''} · <When iso={t.resolvedAt} />
        </p>
      )}
      {t.replies.length > 0 && (
        <ol className="comment-replies">
          {t.replies.map((r) => (
            <li key={r.id}>
              <CommentBody c={r} rights={rights} onChanged={onChanged} />
            </li>
          ))}
        </ol>
      )}
      {replying && (
        <div className="comment-replies">
          <Composer
            label="Reply"
            placeholder="Reply…"
            submitLabel="Reply"
            autoFocus
            onSubmit={async (body) => {
              await api.addComment(page.id, { body, parentId: t.id });
              await onChanged();
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
    </li>
  );
}

export function CommentsPanel({
  page,
  role,
  threads,
  loading,
  error,
  composeBlock,
  focusThread,
  beforeBlockComment,
  onComposeDone,
  onJump,
  onClose,
  closing = false,
  onClosed,
}: {
  page: Page;
  role: Role;
  threads: CommentThread[] | undefined;
  loading: boolean;
  error: unknown;
  /** A block to start a new thread on (from the margin button), or null. */
  composeBlock: string | null;
  /** A thread to scroll to and highlight (from a margin marker); the key restarts it. */
  focusThread: { id: string; key: number } | null;
  /** Runs before a block comment is sent, so a just-typed block is saved first. */
  beforeBlockComment: () => Promise<void>;
  onComposeDone: () => void;
  onJump: (blockId: string) => void;
  onClose: () => void;
  /** True while the panel is playing its closing animation; parent unmounts it on `onClosed`. */
  closing?: boolean;
  onClosed?: () => void;
}) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const ref = useRef<HTMLElement>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const rights: Rights = { me: me.id, canResolve: roleAtLeast(role, 'editor'), canAdmin: roleAtLeast(role, 'admin') };

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: commentsKey(page.id) });
  };

  // Newest first for open threads; resolved ones keep the server's order (newest resolved first).
  const open = (threads ?? []).filter((t) => !t.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const resolved = (threads ?? []).filter((t) => t.resolvedAt);

  useEffect(() => {
    if (!composeBlock) ref.current?.querySelector<HTMLElement>('.panel-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.overlay')) return;
      // Do not throw away text someone is writing.
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && ref.current?.contains(active) && active.value.trim()) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // A marker was clicked: show that thread (open the resolved list if needed) and highlight it.
  useEffect(() => {
    if (!focusThread || !threads) return;
    // The id may be a reply's (a notification links to the comment it is about).
    const t = threads.find((x) => x.id === focusThread.id || x.replies.some((r) => r.id === focusThread.id));
    if (!t) return;
    if (t.resolvedAt) setShowResolved(true);
    setHighlight(t.id);
    const frame = requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>(`[data-thread-id="${t.id}"]`);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    });
    const timer = window.setTimeout(() => setHighlight(null), 1600);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusThread, threads]);

  const blockQuoteText = composeBlock ? blockQuote(page.doc, composeBlock) : null;

  return (
    <aside
      className={`comments-panel${closing ? ' is-closing' : ''}`}
      aria-label="Comments"
      ref={ref}
      onAnimationEnd={(e) => {
        if (closing && e.target === ref.current) onClosed?.();
      }}
    >
      <header className="history-head">
        <h2 className="history-title">Comments</h2>
        <button type="button" className="icon-btn panel-close" onClick={onClose} aria-label="Close comments" title="Close">
          <X size={17} />
        </button>
      </header>

      {composeBlock && (
        <section className="comment-new-block fade-in" aria-label="Comment on a block">
          <p className="comment-anchor comment-quote-static">{blockQuoteText ?? 'A new block'}</p>
          <Composer
            key={composeBlock}
            label="Your comment on this block"
            placeholder="Comment on this block…"
            submitLabel="Comment"
            autoFocus
            onSubmit={async (body) => {
              await beforeBlockComment();
              await api.addComment(page.id, { body, blockId: composeBlock });
              await refresh();
              onComposeDone();
            }}
            onCancel={onComposeDone}
          />
        </section>
      )}

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <div className="comment-lists fade-in">
          {open.length === 0 ? (
            <p className="muted comment-empty">No open comments.</p>
          ) : (
            <ol className="comment-list" aria-label="Open threads">
              {open.map((t) => (
                <Thread key={t.id} t={t} page={page} rights={rights} highlighted={highlight === t.id} onJump={onJump} onChanged={refresh} />
              ))}
            </ol>
          )}

          {resolved.length > 0 && (
            <div className="comment-resolved-group">
              <button
                type="button"
                className={`comment-resolved-toggle${showResolved ? ' is-open' : ''}`}
                aria-expanded={showResolved}
                onClick={() => setShowResolved((v) => !v)}
              >
                <ChevronRight size={15} aria-hidden="true" className="comment-chevron" />
                Resolved ({resolved.length})
              </button>
              {showResolved && (
                <ol className="comment-list fade-in" aria-label="Resolved threads">
                  {resolved.map((t) => (
                    <Thread key={t.id} t={t} page={page} rights={rights} highlighted={highlight === t.id} onJump={onJump} onChanged={refresh} />
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      <div className="comment-page-composer">
        <Composer
          label="Comment on this page"
          placeholder="Comment on this page…"
          submitLabel="Comment"
          onSubmit={async (body) => {
            await api.addComment(page.id, { body });
            await refresh();
          }}
        />
      </div>
    </aside>
  );
}
