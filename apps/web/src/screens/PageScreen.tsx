import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, History, LayoutTemplate, MessageSquare, Plus, Sparkles, Star, Trash2 } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Page } from '@stillwater/shared';
import { SummaryCard, useAiEnabled } from '../ai/SummaryCard';
import { api, ApiFailure, favouritesKey, recentKey } from '../api';
import { BlockMargin } from '../comments/BlockMargin';
import { CommentsPanel } from '../comments/CommentsPanel';
import { blockElement, commentsKey, openThreads, scrollToBlock } from '../comments/blocks';
import { PageEditor, SaveStatus } from '../editor/PageEditor';
import { PageSaver } from '../editor/saver';
import { HistoryPanel, VersionPreview, versionsKey } from '../history/HistoryPanel';
import { SaveAsTemplateDialog } from '../templates/SaveAsTemplate';
import { timeAgo } from '../time';
import { pageTitle } from '../tree';
import { ErrorNote, Loading } from '../ui';
import { NotFound } from './NotFound';
import { useSpace } from './Space';

function TitleEditor({ page, editable, saver }: { page: Page; editable: boolean; saver: PageSaver }) {
  const location = useLocation();
  const [value, setValue] = useState(page.title);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(page.title), [page.id, page.title]);
  useEffect(() => {
    // A dialog opened in the meantime (e.g. the template picker) keeps its focus.
    if (document.activeElement?.closest('[role="dialog"]')) return;
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

/**
 * The star in the page header (done-check 09, 9b). It changes at once; the
 * requests go out one after another so quick clicks land in order, and if the
 * server refuses, the star goes back and a quiet note says so.
 */
function FavouriteButton({ page, onFailed }: { page: Page; onFailed: (failed: boolean) => void }) {
  const qc = useQueryClient();
  const [on, setOn] = useState(page.favourite);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function toggle() {
    const next = !on;
    setOn(next);
    onFailed(false);
    queue.current = queue.current.then(async () => {
      try {
        await api.setFavourite(page.id, next);
        qc.setQueryData<{ page: Page }>(['page', page.id], (old) =>
          old ? { page: { ...old.page, favourite: next } } : old,
        );
      } catch {
        setOn(!next);
        onFailed(true);
      } finally {
        void qc.invalidateQueries({ queryKey: favouritesKey });
      }
    });
  }

  const label = on ? 'Remove from favourites' : 'Add to favourites';
  return (
    <button
      className={`btn btn-quiet btn-star${on ? ' is-on' : ''}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <Star size={16} aria-hidden="true" />
    </button>
  );
}

/** True when the body holds no text and no non-paragraph block. */
function isEmptyDoc(page: Page) {
  const blocks = (page.doc.content ?? []) as { type?: string; content?: unknown[] }[];
  return blocks.every((b) => b.type === 'paragraph' && !b.content?.length);
}

export function PageScreen() {
  const { pageId = '' } = useParams();
  const { space } = useSpace();
  const q = useQuery({ queryKey: ['page', pageId], queryFn: () => api.page(pageId) });

  if (q.isPending) return <Loading />;
  if (q.error) {
    if (q.error instanceof ApiFailure && q.error.status === 404) {
      // "in_trash" only comes to editors and up; viewers just get "Nothing here".
      return <NotFound trashLink={q.error.code === 'in_trash' ? `/s/${space.key}/trash` : undefined} />;
    }
    return <ErrorNote error={q.error} />;
  }
  return <PageView key={pageId} page={q.data.page} />;
}

function PageView({ page }: { page: Page }) {
  const qc = useQueryClient();
  const { space, items, canEdit, newPage, deletePage } = useSpace();
  const [generation, setGeneration] = useState(0);
  // One side panel at a time: History or Comments.
  const [panel, setPanel] = useState<'history' | 'comments' | null>(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const historyOpen = panel === 'history';
  const commentsOpen = panel === 'comments';
  const [viewing, setViewing] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [composeBlock, setComposeBlock] = useState<string | null>(null);
  const [focusThread, setFocusThread] = useState<{ id: string; key: number } | null>(null);
  const [flash, setFlash] = useState<{ blockId: string; key: number } | null>(null);
  // Loaded with the page: the count on the button and the block markers need it.
  const comments = useQuery({ queryKey: commentsKey(page.id), queryFn: () => api.comments(page.id) });
  const threads = comments.data?.threads;
  const openCount = openThreads(threads).length;
  const aiEnabled = useAiEnabled();
  // Each press of Summarise mounts a fresh card, which asks the server once.
  const [summaryRun, setSummaryRun] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const closeSummary = useCallback(() => setSummaryOpen(false), []);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState<string | null>(null);
  const [starFailed, setStarFailed] = useState(false);
  useEffect(() => {
    if (!starFailed) return;
    const t = window.setTimeout(() => setStarFailed(false), 4000);
    return () => window.clearTimeout(t);
  }, [starFailed]);
  // The confirmation fades on its own after a few seconds.
  useEffect(() => {
    if (!templateSaved) return;
    const t = window.setTimeout(() => setTemplateSaved(null), 4000);
    return () => window.clearTimeout(t);
  }, [templateSaved]);
  // Closing plays the panel's exit animation before it unmounts (see onClosed below).
  const closePanel = useCallback(() => {
    setPanelClosing(true);
  }, []);
  const finishClosePanel = useCallback(() => {
    setPanel(null);
    setPanelClosing(false);
    setViewing(null);
    setComposeBlock(null);
  }, []);
  // Opening one panel while the other is open swaps them straight away.
  const openPanel = useCallback(
    (which: 'history' | 'comments') => {
      setPanelClosing(false);
      setPanel(which);
      if (which === 'history') setComposeBlock(null);
      else {
        setViewing(null);
        // The panel shows fresh comments each time it opens.
        void qc.invalidateQueries({ queryKey: commentsKey(page.id) });
      }
    },
    [qc, page.id],
  );
  const openComments = useCallback(
    (opts: { block?: string; thread?: string } = {}) => {
      if (panel !== 'comments' || panelClosing) openPanel('comments');
      setComposeBlock(opts.block ?? null);
      if (opts.thread) setFocusThread({ id: opts.thread, key: Date.now() });
    },
    [panel, panelClosing, openPanel],
  );
  const jumpToBlock = useCallback(
    (blockId: string) => {
      const el = blockElement(editor, blockId);
      if (!el) return;
      scrollToBlock(el);
      setFlash({ blockId, key: Date.now() });
    },
    [editor],
  );
  // Make sure what was typed a moment ago is stored before a block comment or "Save as template" reads it.
  const flushEdits = useCallback(async () => {
    if (!canEdit) return;
    if (editor && document.activeElement && editor.view.dom.contains(document.activeElement)) editor.commands.blur();
    await saver.settled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, editor, generation]);
  const doneComposing = useCallback(() => setComposeBlock(null), []);

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
        // Keep an open history list up to date with this save.
        void qc.invalidateQueries({ queryKey: versionsKey(page.id) });
        // A save can remove a commented block ("on a removed block").
        if (change.doc !== undefined) void qc.invalidateQueries({ queryKey: commentsKey(page.id) });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.id, generation],
  );

  async function reload() {
    await qc.fetchQuery({ queryKey: ['page', page.id], queryFn: () => api.page(page.id), staleTime: 0 });
    setGeneration((g) => g + 1);
  }

  async function afterRestore() {
    await reload();
    setViewing(null);
    void qc.invalidateQueries({ queryKey: ['tree', page.spaceKey] });
    void qc.invalidateQueries({ queryKey: commentsKey(page.id) });
  }

  // One "viewed" record per open of this page (done-check 09). PageView is
  // keyed by page id, so this runs when a page is opened from anywhere, and
  // not on autosave, refetch, reload after a conflict or window focus. The
  // ref keeps React's development double-run from sending it twice.
  const viewSent = useRef(false);
  useEffect(() => {
    if (viewSent.current) return;
    viewSent.current = true;
    api
      .recordView(page.id)
      .then(() => qc.invalidateQueries({ queryKey: recentKey }))
      .catch(() => {
        // A missed view only leaves the Recently viewed list a step behind.
      });
  }, [qc, page.id]);

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
        <div className="row">
          <FavouriteButton page={page} onFailed={setStarFailed} />
          <button
            className={`btn btn-quiet${historyOpen ? ' is-on' : ''}`}
            onClick={() => (historyOpen && !panelClosing ? closePanel() : openPanel('history'))}
            aria-expanded={historyOpen}
          >
            <History size={16} aria-hidden="true" /> History
          </button>
          <button
            className={`btn btn-quiet${commentsOpen ? ' is-on' : ''}`}
            onClick={() => (commentsOpen && !panelClosing ? closePanel() : openComments())}
            aria-expanded={commentsOpen}
          >
            <MessageSquare size={16} aria-hidden="true" /> Comments
            {openCount > 0 && (
              <span className="count-badge" aria-label={`${openCount} open`}>
                {openCount}
              </span>
            )}
          </button>
          {aiEnabled && (
            <button
              className={`btn btn-quiet${summaryOpen ? ' is-on' : ''}`}
              onClick={() => {
                setSummaryRun((n) => n + 1);
                setSummaryOpen(true);
              }}
              aria-expanded={summaryOpen}
            >
              <Sparkles size={16} aria-hidden="true" /> Summarise
            </button>
          )}
          {canEdit && (
            <>
              <button className="btn btn-quiet" onClick={() => setSavingTemplate(true)}>
                <LayoutTemplate size={16} aria-hidden="true" /> Save as template
              </button>
              <button className="btn btn-quiet" onClick={() => newPage(page.id)}>
                <Plus size={16} aria-hidden="true" /> Sub-page
              </button>
              <button className="icon-btn" onClick={() => deletePage(page.id)} aria-label="Delete page" title="Delete page">
                <Trash2 size={17} />
              </button>
            </>
          )}
        </div>
      </div>

      {starFailed && (
        <p className="note star-note fade-in" role="status">
          Couldn’t update favourites. Try again in a moment.
        </p>
      )}
      {templateSaved && (
        <p className="note template-saved fade-in" role="status">
          Saved as template “{templateSaved}”. It is in the picker for new pages in this space.
        </p>
      )}
      {canEdit && savingTemplate && (
        <SaveAsTemplateDialog
          spaceKey={space.key}
          pageId={page.id}
          pageTitle={page.title}
          beforeSave={flushEdits}
          onClose={() => setSavingTemplate(false)}
          onSaved={(name) => {
            setSavingTemplate(false);
            setTemplateSaved(name);
          }}
        />
      )}

      {historyOpen && (
        <HistoryPanel
          page={page}
          selected={viewing}
          onSelect={setViewing}
          onClose={closePanel}
          closing={panelClosing}
          onClosed={finishClosePanel}
        />
      )}

      {commentsOpen && (
        <CommentsPanel
          page={page}
          role={space.myRole}
          threads={threads}
          loading={comments.isPending}
          error={comments.error}
          composeBlock={composeBlock}
          focusThread={focusThread}
          beforeBlockComment={flushEdits}
          onComposeDone={doneComposing}
          onJump={jumpToBlock}
          onClose={closePanel}
          closing={panelClosing}
          onClosed={finishClosePanel}
        />
      )}

      {aiEnabled && summaryOpen && <SummaryCard key={summaryRun} pageId={page.id} onClose={closeSummary} />}

      <div className="page-body" ref={bodyRef}>
        {viewing !== null ? (
          <VersionPreview
            page={page}
            version={viewing}
            canRestore={canEdit}
            saver={saver}
            onClose={() => setViewing(null)}
            onRestored={afterRestore}
            onReload={reload}
          />
        ) : !canEdit && isEmptyDoc(page) ? (
          <p className="muted">This page has no content yet.</p>
        ) : (
          <PageEditor
            key={`${page.id}:${generation}`}
            page={page}
            spaceKey={space.key}
            editable={canEdit}
            saver={saver}
            onReload={reload}
            onEditor={setEditor}
          />
        )}
        {viewing === null && (
          <BlockMargin
            editor={editor}
            host={bodyRef}
            threads={threads ?? []}
            flash={flash}
            onAdd={(block) => openComments({ block })}
            onOpen={(thread) => openComments({ thread })}
          />
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
