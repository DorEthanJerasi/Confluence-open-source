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

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} ref={ref}>
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
