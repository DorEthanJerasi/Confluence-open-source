// Small shared building blocks. All styling lives in styles/app.css and only
// uses tokens from tokens.css.
import { useEffect, useRef, type ReactNode } from 'react';
import type { Role } from '@stillwater/shared';

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p className="note note-danger" role="alert">
      {msg}
    </p>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex], [contenteditable="true"]';

/**
 * A dialog that keeps focus inside it: Tab and Shift+Tab wrap around, Escape
 * closes, and focus goes back to where it was when it closes. The first field
 * (or `[data-autofocus]`) gets focus once, when it opens.
 */
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    (box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>('input, select, textarea, button'))?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal${props.className ? ` ${props.className}` : ''}`} role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
        <h2 className="modal-title">{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

export function RoleSelect(props: { value: Role; onChange: (r: Role) => void; disabled?: boolean; label?: string }) {
  return (
    <select
      className="input input-compact"
      aria-label={props.label ?? 'Role'}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value as Role)}
    >
      <option value="viewer">Viewer</option>
      <option value="editor">Editor</option>
      <option value="admin">Admin</option>
    </select>
  );
}

export function Loading() {
  return (
    <div className="loading" aria-live="polite">
      <span className="loading-dot" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
