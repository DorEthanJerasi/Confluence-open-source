import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, History, LayoutTemplate, MessageSquare, Plus, Sparkles, Star, Trash2, X } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Page } from '@stillwater/shared';
import { SummaryCard, useAiEnabled } from '../ai/SummaryCard';
import { api, ApiFailure, favouritesKey, recentKey } from '../api';
import { BlockMargin } from '../comments/BlockMargin';
import { CommentsPanel } from '../comments/CommentsPanel';
import { blockElement, commentsKey, openThreads, scrollToBlock } from '../comments/blocks';
import { PageEditor, SaveStatus } from '../editor/PageEditor';
import { ExportMenu } from '../export/ExportMenu';
import { PageSaver } from '../editor/saver';
import { HistoryPanel, VersionPreview, versionsKey } from '../history/HistoryPanel';
import { PageLabels } from '../labels/PageLabels';
import { docText, LockButton, LockedOutNote, LockNote, type LockedOut } from '../locks/LockControls';
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
      // A conflict is shown once, above the body, with a Reload button; a lock
      // (423) turns the page read-only and keeps the text in a note instead.
      if (!(err instanceof ApiFailure && (err.status === 409 || err.status === 423))) setError(err);
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

/**
 * Follow / Following, next to the star (done-check 15, 15b). Anyone who can
 * read the page (viewers too) can follow it and is then told about comments
 * and edits. Like the star: it changes at once, requests go out in order, and
 * if the server refuses it goes back and a quiet note says so.
 */
function FollowButton({ page, onFailed }: { page: Page; onFailed: (failed: boolean) => void }) {
  const qc = useQueryClient();
  const [on, setOn] = useState(page.following);
  const queue = useRef<Promise<void>>(Promise.resolve());

  function toggle() {
    const next = !on;
    setOn(next);
    onFailed(false);
    queue.current = queue.current.then(async () => {
      try {
        const { following } = await api.setFollow(page.id, next);
        qc.setQueryData<{ page: Page }>(['page', page.id], (old) => (old ? { page: { ...old.page, following } } : old));
      } catch {
        setOn(!next);
        onFailed(true);
      }
    });
  }

  return (
    <button
      className={`btn btn-quiet btn-follow${on ? ' is-on' : ''}`}
      onClick={toggle}
      aria-pressed={on}
      title={on ? 'You are told about comments and edits here. Click to stop.' : 'Be told about comments and edits on this page'}
    >
      <Eye size={16} aria-hidden="true" />
      {on ? 'Following' : 'Follow'}
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
  const { space, items, canEdit, newPage, deletePage, trashNote, clearTrashNote } = useSpace();
  // A locked page is read-only for everyone, the locker included (done-check 17).
  const locked = page.lock !== null;
  const editable = canEdit && !locked;
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
  // A quiet note when the star or Follow could not be changed; it fades on its own.
  const [headNote, setHeadNote] = useState<string | null>(null);
  useEffect(() => {
    if (!headNote) return;
    const t = window.setTimeout(() => setHeadNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [headNote]);
  const starFailed = useCallback((failed: boolean) => setHeadNote(failed ? 'Couldn’t update favourites. Try again in a moment.' : null), []);
  const followFailed = useCallback(
    (failed: boolean) => setHeadNote(failed ? 'Couldn’t change following for this page. Try again in a moment.' : null),
    [],
  );
  // Why an export could not start (a 413's plain message, or a short note). It
  // stays until dismissed or the next export, so a long message can be read.
  const [exportNote, setExportNote] = useState<string | null>(null);
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
  // A comment notification links here with ?comment=<id>: open the comments
  // panel on that comment, then drop the parameter so a reload stays quiet.
  const [params, setParams] = useSearchParams();
  const commentParam = params.get('comment');
  useEffect(() => {
    if (!commentParam) return;
    openComments({ thread: commentParam });
    setParams(
      (p) => {
        p.delete('comment');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentParam]);
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

  // Lock / Unlock (editors and up). Typed text is saved first, so locking
  // never throws away the locker's own last words.
  const [lockBusy, setLockBusy] = useState(false);
  async function toggleLock() {
    if (lockBusy) return;
    setLockBusy(true);
    setHeadNote(null);
    try {
      if (!locked) {
        await flushEdits();
        const { lock } = await api.setLock(page.id, true);
        qc.setQueryData<{ page: Page }>(['page', page.id], (old) => (old ? { page: { ...old.page, lock } } : old));
      } else {
        await api.setLock(page.id, false);
        // A fresh saver and the newest page, so editing starts from what is stored.
        await reload();
      }
    } catch {
      setHeadNote(locked ? 'Couldn’t unlock this page. Try again in a moment.' : 'Couldn’t lock this page. Try again in a moment.');
    } finally {
      setLockBusy(false);
    }
  }

  // Someone else locked the page while this person was writing: their save
  // got a 423. Stop the editor at once, keep what was not saved in a note
  // with Copy, then load the page again (now read-only, with "Locked by").
  const [lockedOut, setLockedOut] = useState<LockedOut | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

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

  useEffect(() => {
    let handled = false;
    return saver.subscribe(() => {
      if (saver.state !== 'locked' || handled) return;
      handled = true;
      const ed = editorRef.current;
      const live = ed && !ed.isDestroyed && ed.isEditable ? ed : null;
      // The editor holds the newest text, even what was typed after the refused save.
      const doc = live ? (live.getJSON() as Page['doc']) : saver.unsaved?.doc;
      live?.setEditable(false);
      const unsaved = saver.unsaved;
      const out: LockedOut = {
        ...(unsaved?.title !== undefined ? { title: unsaved.title } : {}),
        ...(unsaved?.doc !== undefined && doc ? { text: docText(doc) } : {}),
      };
      if (out.title !== undefined || out.text) setLockedOut(out);
      reload().catch(() => {
        // The page stays as it is; the next try shows the lock or an error.
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver]);

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
          <TitleEditor key={generation} page={page} editable={editable} saver={saver} />
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
          <LockNote lock={page.lock} />
          <PageLabels page={page} spaceKey={space.key} canEdit={canEdit} />
        </div>
        <div className="row">
          <FavouriteButton page={page} onFailed={starFailed} />
          <FollowButton page={page} onFailed={followFailed} />
          <ExportMenu page={page} onNote={setExportNote} />
          {canEdit && <LockButton locked={locked} busy={lockBusy} onToggle={toggleLock} />}
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
              {/* Locked: still focusable, so the reason can be found by keyboard and read out. */}
              <button
                className="icon-btn"
                onClick={() => !locked && deletePage(page.id)}
                aria-label="Delete page"
                aria-disabled={locked || undefined}
                aria-describedby={locked ? 'lock-trash-hint' : undefined}
                title={locked ? 'Unlock the page to move it to the trash' : 'Delete page'}
              >
                <Trash2 size={17} aria-hidden="true" />
              </button>
              {locked && (
                <span id="lock-trash-hint" className="sr-only">
                  Unlock the page to move it to the trash
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {headNote && (
        <p className="note star-note fade-in" role="status">
          {headNote}
        </p>
      )}
      {exportNote && (
        <div className="note export-note fade-in" role="status">
          <span>{exportNote}</span>
          <button className="icon-btn icon-btn-sm" onClick={() => setExportNote(null)} aria-label="Dismiss" title="Dismiss">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {trashNote && (
        <div className="note export-note fade-in" role="status">
          <span>{trashNote}</span>
          <button className="icon-btn icon-btn-sm" onClick={clearTrashNote} aria-label="Dismiss" title="Dismiss">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {lockedOut && <LockedOutNote out={lockedOut} onDismiss={() => setLockedOut(null)} />}
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
            canRestore={editable}
            lockedHint={canEdit && locked}
            saver={saver}
            onClose={() => setViewing(null)}
            onRestored={afterRestore}
            onReload={reload}
          />
        ) : !editable && isEmptyDoc(page) ? (
          <p className="muted">This page has no content yet.</p>
        ) : (
          <PageEditor
            // Locking or unlocking mounts a fresh editor: switching one in place
            // would make React remove the bubble menus Tippy has moved away.
            key={`${page.id}:${generation}:${editable ? 'edit' : 'read'}`}
            page={page}
            spaceKey={space.key}
            editable={editable}
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
