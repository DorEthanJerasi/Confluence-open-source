// Page locks on the screen (docs/done-checks/17-locks.md, 17b).
//
// - LockButton: Lock / Unlock in the page header, for editors and up only.
// - LockNote: the one quiet "Locked by Ada Lind · 12 Nov" line under the
//   title, for everyone. It fades in on lock and out on unlock (instant under
//   reduced motion, see tokens.css).
// - LockedOutNote: when someone else locked the page while this person was
//   writing, their next save is refused (423). The page turns read-only and
//   this note keeps what they had not saved, with a Copy button, so nothing is
//   lost silently.
import { useEffect, useState } from 'react';
import { Lock, LockOpen, X } from 'lucide-react';
import type { Doc, PageLock } from '@stillwater/shared';
import { exactTime, shortDate } from '../time';

export function LockButton({ locked, busy, onToggle }: { locked: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`btn btn-quiet btn-lock${locked ? ' is-on' : ''}`}
      // Not `disabled` while busy: that would drop keyboard focus to the page.
      onClick={() => !busy && onToggle()}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      title={locked ? 'Let people edit this page again' : 'Make this page read-only for everyone until it is unlocked'}
    >
      {locked ? <LockOpen size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
      {locked ? 'Unlock' : 'Lock'}
    </button>
  );
}

/**
 * The quiet line under the title. The live region is always there, so a lock
 * that arrives while the page is open is read out once; the line itself stays
 * mounted for its fade-out after an unlock.
 */
export function LockNote({ lock }: { lock: PageLock | null }) {
  const [shown, setShown] = useState<PageLock | null>(lock);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (lock) {
      setShown(lock);
      setLeaving(false);
    } else setLeaving(true);
  }, [lock]);

  return (
    <div className="lock-slot" role="status" aria-live="polite">
      {shown && (
        <p
          className={`lock-note${leaving ? ' is-leaving' : ' fade-in'}`}
          onAnimationEnd={() => {
            if (!leaving) return;
            setShown(null);
            setLeaving(false);
          }}
        >
          <Lock size={14} aria-hidden="true" className="lock-note-icon" />
          <span>
            {shown.by ? `Locked by ${shown.by.name}` : 'Locked'}
            {' · '}
            <time dateTime={shown.at} title={exactTime(shown.at)}>
              {shortDate(shown.at)}
            </time>
          </span>
        </p>
      )}
    </div>
  );
}

/** What was not saved when the lock came in: the title (if changed) and the body as plain text. */
export interface LockedOut {
  title?: string;
  text?: string;
}

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };
const INLINE_BREAK = new Set(['hardBreak']);

/** The body as plain text, one line per block, so it can be pasted anywhere. */
export function docText(doc: Doc): string {
  const lines: string[] = [];
  const inline = (n: Node): string => {
    if (n.type === 'text') return n.text ?? '';
    if (INLINE_BREAK.has(n.type ?? '')) return '\n';
    if (n.type === 'mention') return `@${String(n.attrs?.label ?? '')}`;
    return (n.content ?? []).map(inline).join('');
  };
  const block = (n: Node) => {
    const kids = n.content ?? [];
    // A block whose children are inline (text, breaks, mentions) is one line.
    if (kids.length && kids.every((k) => k.type === 'text' || k.type === 'mention' || INLINE_BREAK.has(k.type ?? ''))) {
      lines.push(kids.map(inline).join(''));
      return;
    }
    if (!kids.length) {
      if (n.type === 'paragraph') {
        lines.push('');
        return;
      }
      // Embeds keep the one thing that names them: a link, a file name, a caption.
      const a = n.attrs ?? {};
      const name = [a.url, a.embedUrl, a.filename, a.caption].find((v) => typeof v === 'string' && v);
      if (name) lines.push(String(name));
      return;
    }
    kids.forEach(block);
  };
  ((doc as Node).content ?? []).forEach(block);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function LockedOutNote({ out, onDismiss }: { out: LockedOut; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = [out.title !== undefined ? out.title : null, out.text ?? null].filter((t) => t !== null).join('\n\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="note locked-out fade-in" aria-label="Your unsaved text">
      <div className="locked-out-head">
        <p>
          <strong>This page was locked while you were writing</strong>, so your last changes were not saved. Your text is
          below. Copy it to keep it.
        </p>
        <button type="button" className="icon-btn icon-btn-sm" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {text && (
        <pre className="locked-out-text" tabIndex={0} aria-label="Unsaved text">
          {text}
        </pre>
      )}
      <div className="row">
        <button type="button" className="btn btn-quiet btn-sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy my text'}
        </button>
      </div>
    </section>
  );
}
