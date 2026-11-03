// Page history (done-check 03, 3c): the side panel that lists saved versions,
// and the read-only preview of one version with its Restore button.
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, X } from 'lucide-react';
import type { Page, PageVersionSummary } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import type { PageSaver } from '../editor/saver';
import { exactTime, timeAgo } from '../time';
import { pageTitle } from '../tree';
import { ErrorNote, Loading, Modal } from '../ui';
import { VersionDoc } from './VersionDoc';

export const versionsKey = (pageId: string) => ['versions', pageId] as const;

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={exactTime(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

function VersionRow({
  v,
  current,
  selected,
  onOpen,
}: {
  v: PageVersionSummary;
  current: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`version-row${selected ? ' is-selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        data-version={v.version}
      >
        <span className="version-row-top">
          <span className="version-author">{v.author?.name ?? 'Removed user'}</span>
          <span className="version-when muted">
            <When iso={v.savedAt} />
          </span>
        </span>
        <span className="version-row-bottom">
          <span className="version-number faint">Version {v.version}</span>
          {current && <span className="version-tag version-tag-current">Current</span>}
          {v.restoredFrom !== null && <span className="version-tag">Restored from version {v.restoredFrom}</span>}
        </span>
      </button>
    </li>
  );
}

export function HistoryPanel({
  page,
  selected,
  onSelect,
  onClose,
}: {
  page: Page;
  selected: number | null;
  onSelect: (version: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const q = useInfiniteQuery({
    queryKey: versionsKey(page.id),
    queryFn: ({ pageParam }) => api.versions(page.id, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 0,
  });

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.panel-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the panel unless a dialog (the restore question) is open on top.
      if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const versions = q.data?.pages.flatMap((p) => p.versions) ?? [];

  return (
    <aside className="history-panel" aria-label="Page history" ref={ref}>
      <header className="history-head">
        <h2 className="history-title">History</h2>
        <button type="button" className="icon-btn panel-close" onClick={onClose} aria-label="Close history" title="Close">
          <X size={17} />
        </button>
      </header>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <>
          <ol className="version-list fade-in">
            {versions.map((v) => (
              <VersionRow
                key={v.version}
                v={v}
                current={v.version === page.version}
                selected={v.version === selected}
                onOpen={() => onSelect(v.version)}
              />
            ))}
          </ol>
          {q.hasNextPage && (
            <button
              type="button"
              className="btn btn-quiet btn-sm load-older"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              {q.isFetchingNextPage ? 'Loading…' : 'Load older'}
            </button>
          )}
        </>
      )}
    </aside>
  );
}

/**
 * One version in the page's place: read-only, with the block diff against the
 * current page. Space editors and admins can restore it.
 */
export function VersionPreview({
  page,
  version,
  canRestore,
  saver,
  onClose,
  onRestored,
  onReload,
}: {
  page: Page;
  version: number;
  canRestore: boolean;
  saver: PageSaver;
  onClose: () => void;
  onRestored: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['version', page.id, version], queryFn: () => api.version(page.id, version) });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    setError(null);
    setConflict(false);
  }, [version]);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      // Let any save in flight finish so the restore builds on the newest version.
      await saver.settled();
      if (saver.state === 'conflict') throw new ApiFailure(409, 'stale_version', 'This page was changed elsewhere.');
      await api.restoreVersion(page.id, version, saver.version);
      setAsking(false);
      await qc.invalidateQueries({ queryKey: versionsKey(page.id) });
      await onRestored();
    } catch (err) {
      setAsking(false);
      if (err instanceof ApiFailure && err.status === 409) setConflict(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setConflict(false);
    await onReload();
    await qc.invalidateQueries({ queryKey: versionsKey(page.id) });
  }

  const v = q.data;
  return (
    <section className="version-preview fade-in" aria-label={`Version ${version}`} key={version}>
      <div className="version-bar">
        <div className="grow">
          <p className="version-bar-title">
            Version {version}
            {v && (
              <span className="muted">
                {' '}
                · {v.author?.name ?? 'Removed user'} · <When iso={v.savedAt} />
              </span>
            )}
          </p>
          <p className="faint version-bar-hint">Read-only. The page itself is unchanged until you restore.</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
            Back to page
          </button>
          {canRestore && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAsking(true)} disabled={!v || busy}>
              <RotateCcw size={15} aria-hidden="true" /> Restore this version
            </button>
          )}
        </div>
      </div>

      {conflict && (
        <div className="conflict-note fade-in" role="alert">
          <p>
            <strong>This page was changed somewhere else</strong> since you opened it, so nothing was restored. Reload to get
            the latest version, then restore again if you still want to.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={reload}>
              Reload
            </button>
          </div>
        </div>
      )}
      <ErrorNote error={error} />

      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <>
          {v!.title !== page.title && (
            <p className="version-old-title">
              <span className="diff-label diff-label-changed">Title then</span> {pageTitle(v!.title)}
            </p>
          )}
          <VersionDoc version={v!.doc} current={page.doc} />
        </>
      )}

      {asking && (
        <Modal title="Restore this version?" onClose={() => !busy && setAsking(false)}>
          <p>This becomes the current page. Nothing is deleted.</p>
          <div className="row row-end">
            <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={restore} disabled={busy}>
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
