import { useEffect, useRef, useState } from 'react';
import { Check, Download, FileText, Hash } from 'lucide-react';
import type { ExportFormat, Page } from '@stillwater/shared';
import { api, ApiFailure } from '../api';

/**
 * Export, next to Follow and the star (done-check 16b). Anyone who can read
 * the page can use it. The menu offers Markdown and PDF and, when the page
 * has sub-pages, "This page only" / "This page and its N sub-pages".
 *
 * Picking a format first asks the server's quick check (`check=1`: the same
 * 404 / 413 as the export, but nothing is built), so a too-large export is a
 * quiet note on the page. Then the file comes through a plain link: the
 * browser downloads it with its own sign-in cookie, no script holds the file.
 *
 * Keyboard: Enter, Space or Arrow down opens the menu on its first item;
 * arrows, Home and End move; Enter or Space picks; Escape closes with focus
 * back on the button; Tab closes it.
 */
export function ExportMenu({ page, onNote }: { page: Page; onNote: (note: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [withChildren, setWithChildren] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const hasChildren = page.childCount > 0;
  const children = hasChildren && withChildren;

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  // Opening puts focus on the first item, so the arrows work straight away.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  // A click anywhere else closes the menu quietly.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') setOpen(false);
  }

  async function download(format: ExportFormat) {
    close();
    onNote(null);
    setBusy(true);
    try {
      await api.checkExport(page.id, format, children);
      const link = document.createElement('a');
      link.href = api.exportUrl(page.id, format, children);
      link.download = '';
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      onNote(
        err instanceof ApiFailure && err.status === 413
          ? err.message
          : err instanceof ApiFailure && err.status === 404
            ? 'This page can’t be exported any more. It may have been moved to the trash.'
            : 'Couldn’t prepare the export. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  const scope = (value: boolean, label: string) => (
    <button
      role="menuitemradio"
      aria-checked={withChildren === value}
      tabIndex={-1}
      onClick={() => setWithChildren(value)}
    >
      <span className="export-check" aria-hidden="true">
        {withChildren === value && <Check size={14} />}
      </span>
      {label}
    </button>
  );

  return (
    <span className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        className={`btn btn-quiet${open ? ' is-on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        title="Download this page as Markdown or PDF"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Download size={16} aria-hidden="true" />
        {busy ? 'Preparing…' : 'Export'}
      </button>
      {open && (
        <div className="menu export-menu" role="menu" aria-label="Export this page" ref={menu} onKeyDown={onMenuKey}>
          {hasChildren && (
            <>
              <div role="group" aria-label="What to export">
                {scope(false, 'This page only')}
                {scope(true, `This page and its ${page.childCount} ${page.childCount === 1 ? 'sub-page' : 'sub-pages'}`)}
              </div>
              <div className="menu-separator" role="separator" />
            </>
          )}
          <div role="group" aria-label="Download as">
            <button role="menuitem" tabIndex={-1} onClick={() => void download('md')}>
              <Hash size={14} aria-hidden="true" /> Markdown
            </button>
            <button role="menuitem" tabIndex={-1} onClick={() => void download('pdf')}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
