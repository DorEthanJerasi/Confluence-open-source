import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { Page } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import { pageTitle } from '../tree';
import { ErrorNote, Loading } from '../ui';
import { NotFound } from './NotFound';
import { useSpace } from './Space';

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Plain text of each top-level block, until the block editor arrives. */
function docParagraphs(page: Page): string[] {
  const out: string[] = [];
  const text = (n: unknown): string => {
    if (!n || typeof n !== 'object') return '';
    const node = n as { text?: string; content?: unknown[] };
    return (node.text ?? '') + (node.content ?? []).map(text).join('');
  };
  for (const block of page.doc.content ?? []) {
    const t = text(block).trim();
    if (t) out.push(t);
  }
  return out;
}

function TitleEditor({ page, editable }: { page: Page; editable: boolean }) {
  const qc = useQueryClient();
  const location = useLocation();
  const [value, setValue] = useState(page.title);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(page.title), [page.id, page.title]);
  useEffect(() => {
    if ((location.state as { focusTitle?: boolean } | null)?.focusTitle) ref.current?.focus();
  }, [page.id, location.state]);

  async function save() {
    const title = value.trim();
    if (title === page.title || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { version } = await api.savePage(page.id, { baseVersion: page.version, title });
      qc.setQueryData<{ page: Page }>(['page', page.id], (old) =>
        old ? { page: { ...old.page, title, version, updatedAt: new Date().toISOString() } } : old,
      );
      await qc.invalidateQueries({ queryKey: ['tree', page.spaceKey] });
      await qc.invalidateQueries({ queryKey: ['page', page.id] });
    } catch (err) {
      setError(err);
      if (err instanceof ApiFailure && err.status === 409) await qc.invalidateQueries({ queryKey: ['page', page.id] });
    } finally {
      setSaving(false);
    }
  }

  if (!editable) return <h1 className="page-title page-title-lg">{pageTitle(page.title)}</h1>;
  return (
    <>
      <input
        ref={ref}
        className="title-input"
        aria-label="Page title"
        placeholder="Untitled"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(page.title);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      <ErrorNote error={error} />
    </>
  );
}

export function PageScreen() {
  const { pageId = '' } = useParams();
  const { space, items, canEdit, newPage, deletePage } = useSpace();
  const q = useQuery({ queryKey: ['page', pageId], queryFn: () => api.page(pageId) });

  if (q.isPending) return <Loading />;
  if (q.error) {
    if (q.error instanceof ApiFailure && q.error.status === 404) return <NotFound />;
    return <ErrorNote error={q.error} />;
  }
  const page = q.data.page;
  const children = items.filter((i) => i.parentId === page.id);
  const paragraphs = docParagraphs(page);

  return (
    <article className="content fade-in" key={page.id}>
      <nav className="crumbs" aria-label="Breadcrumbs">
        <Link to={`/s/${space.key}`}>{space.name}</Link>
        {page.breadcrumbs.map((c) => (
          <span key={c.id} className="crumb">
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <Link to={`/s/${space.key}/p/${c.id}`}>{pageTitle(c.title)}</Link>
          </span>
        ))}
      </nav>

      <div className="page-head page-head-top">
        <div className="grow">
          <TitleEditor page={page} editable={canEdit} />
          <p className="meta muted">
            {page.updatedBy ? `Edited by ${page.updatedBy.name} · ` : ''}
            {timeAgo(page.updatedAt)}
          </p>
        </div>
        {canEdit && (
          <div className="row">
            <button className="btn btn-quiet" onClick={() => newPage(page.id)}>
              <Plus size={16} aria-hidden="true" /> Sub-page
            </button>
            <button className="icon-btn" onClick={() => deletePage(page.id)} aria-label="Delete page" title="Delete page">
              <Trash2 size={17} />
            </button>
          </div>
        )}
      </div>

      <div className="page-body">
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p className="muted">This page has no content yet.</p>
        )}
      </div>

      {children.length > 0 && (
        <section className="subpages">
          <h2 className="section-title">Sub-pages</h2>
          <ul className="list">
            {children.map((c) => (
              <li key={c.id}>
                <Link to={`/s/${space.key}/p/${c.id}`} className="list-link">
                  <FileText size={16} className="faint" aria-hidden="true" />
                  {pageTitle(c.title)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
