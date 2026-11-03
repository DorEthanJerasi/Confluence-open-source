import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import type { Page } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import { PageEditor, SaveStatus } from '../editor/PageEditor';
import { PageSaver } from '../editor/saver';
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

function TitleEditor({ page, editable, saver }: { page: Page; editable: boolean; saver: PageSaver }) {
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
      await saver.save({ title });
    } catch (err) {
      // A conflict is shown once, above the body, with a Reload button.
      if (!(err instanceof ApiFailure && err.status === 409)) setError(err);
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

/** True when the body holds no text and no non-paragraph block. */
function isEmptyDoc(page: Page) {
  const blocks = (page.doc.content ?? []) as { type?: string; content?: unknown[] }[];
  return blocks.every((b) => b.type === 'paragraph' && !b.content?.length);
}

export function PageScreen() {
  const { pageId = '' } = useParams();
  const q = useQuery({ queryKey: ['page', pageId], queryFn: () => api.page(pageId) });

  if (q.isPending) return <Loading />;
  if (q.error) {
    if (q.error instanceof ApiFailure && q.error.status === 404) return <NotFound />;
    return <ErrorNote error={q.error} />;
  }
  return <PageView page={q.data.page} />;
}

function PageView({ page }: { page: Page }) {
  const qc = useQueryClient();
  const { space, items, canEdit, newPage, deletePage } = useSpace();
  const [generation, setGeneration] = useState(0);

  // One saver per page load; Reload after a conflict starts a fresh one.
  const saver = useMemo(
    () =>
      new PageSaver(page.id, page.version, (version, change) => {
        qc.setQueryData<{ page: Page }>(['page', page.id], (old) =>
          old
            ? {
                page: {
                  ...old.page,
                  ...(change.title !== undefined ? { title: change.title } : {}),
                  ...(change.doc !== undefined ? { doc: change.doc } : {}),
                  version,
                  updatedAt: new Date().toISOString(),
                },
              }
            : old,
        );
        if (change.title !== undefined) void qc.invalidateQueries({ queryKey: ['tree', page.spaceKey] });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.id, generation],
  );

  async function reload() {
    await qc.fetchQuery({ queryKey: ['page', page.id], queryFn: () => api.page(page.id), staleTime: 0 });
    setGeneration((g) => g + 1);
  }

  const children = items.filter((i) => i.parentId === page.id);

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
          <TitleEditor key={generation} page={page} editable={canEdit} saver={saver} />
          <p className="meta muted">
            {page.updatedBy ? `Edited by ${page.updatedBy.name} · ` : ''}
            {timeAgo(page.updatedAt)}
            {canEdit && (
              <>
                {' '}
                <SaveStatus saver={saver} />
              </>
            )}
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
        {!canEdit && isEmptyDoc(page) ? (
          <p className="muted">This page has no content yet.</p>
        ) : (
          <PageEditor key={`${page.id}:${generation}`} page={page} editable={canEdit} saver={saver} onReload={reload} />
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
