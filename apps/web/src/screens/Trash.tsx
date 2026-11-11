// Trash on screen (docs/done-checks/11-trash.md, 11b): the Trash view of a
// space at /s/:key/trash, and "Deleted spaces" on Home. Editors and up see a
// space's trash and restore from it; space admins also delete for good and
// empty it. Viewers never get here (no link, and the server says 403).
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FolderOpen, RotateCcw, Trash2 } from 'lucide-react';
import { roleAtLeast } from '@stillwater/shared';
import { api, ApiFailure, unreadKey, type TrashPerson } from '../api';
import { pageTitle } from '../tree';
import { exactTime, timeAgo } from '../time';
import { keptFor, plural, trashKey, trashedSpacesKey } from '../trash';
import { ErrorNote, Loading, Modal } from '../ui';
import { useSpace } from './Space';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Matches --motion-base: how long a restored row takes to fade out. */
const LEAVE_MS = 200;

function purgeLine(purgeAt: string | null): string | null {
  if (!purgeAt) return null;
  const days = Math.ceil((new Date(purgeAt).getTime() - Date.now()) / DAY_MS);
  return days <= 1 ? 'Deleted for good within a day' : `Deleted for good in ${days} days`;
}

/** Waits for the fade-out, unless the person asked for less motion. */
function afterFade(fn: () => void) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) fn();
  else window.setTimeout(fn, LEAVE_MS);
}

function TrashRow(props: {
  icon: ReactNode;
  title: string;
  extra?: string | null;
  deletedAt: string;
  deletedBy: TrashPerson | null;
  purgeAt: string | null;
  leaving: boolean;
  busy: boolean;
  onRestore: () => void;
  onPurge?: () => void;
}) {
  const purge = purgeLine(props.purgeAt);
  return (
    <li className={`trash-item${props.leaving ? ' is-leaving' : ''}`}>
      <span className="trash-icon faint" aria-hidden="true">
        {props.icon}
      </span>
      <div className="trash-text">
        <span className="trash-title">{props.title}</span>
        <span className="trash-meta muted small">
          {props.extra && <span>{props.extra}</span>}
          <span>
            Deleted{props.deletedBy ? ` by ${props.deletedBy.name}` : ''}{' '}
            <time dateTime={props.deletedAt} title={exactTime(props.deletedAt)}>
              {timeAgo(props.deletedAt)}
            </time>
          </span>
          {purge && <span>{purge}</span>}
        </span>
      </div>
      <div className="trash-actions">
        <button className="btn btn-sm" onClick={props.onRestore} disabled={props.busy} aria-label={`Restore “${props.title}”`}>
          <RotateCcw size={14} aria-hidden="true" /> Restore
        </button>
        {props.onPurge && (
          <button
            className="btn btn-sm btn-danger"
            onClick={props.onPurge}
            disabled={props.busy}
            aria-label={`Delete “${props.title}” for good`}
          >
            Delete for good
          </button>
        )}
      </div>
    </li>
  );
}

/** A quiet confirm for things that cannot be undone. */
function ConfirmForGood(props: {
  title: string;
  text: string;
  action: string;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p className="muted">{props.text} This cannot be undone.</p>
      <ErrorNote error={props.error} />
      <div className="row row-end">
        <button className="btn btn-quiet" onClick={props.onClose} data-autofocus>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={props.onConfirm} disabled={props.pending}>
          {props.action}
        </button>
      </div>
    </Modal>
  );
}

/** /s/:key/trash: the space's Trash view. */
export function TrashScreen() {
  const { space, canEdit } = useSpace();
  const qc = useQueryClient();
  const isAdmin = roleAtLeast(space.myRole, 'admin');
  const q = useQuery({ queryKey: trashKey(space.key), queryFn: () => api.trash(space.key), enabled: canEdit });
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [back, setBack] = useState<{ id: string; title: string } | null>(null);
  const [purging, setPurging] = useState<{ id: string; title: string; subPages: number } | null>(null);
  const [emptying, setEmptying] = useState(false);

  const refreshTrash = () => qc.invalidateQueries({ queryKey: trashKey(space.key) });
  const restore = useMutation({
    mutationFn: (id: string) => api.restorePage(id),
    onSuccess: async ({ page }) => {
      setLeaving((s) => new Set(s).add(page.id));
      // Pages under it may have been cached as "not found" while it was in the trash.
      qc.removeQueries({ queryKey: ['page'] });
      void qc.invalidateQueries({ queryKey: unreadKey });
      await qc.invalidateQueries({ queryKey: ['tree', space.key] });
      afterFade(() => {
        setBack({ id: page.id, title: page.title });
        void refreshTrash();
      });
    },
  });
  const purge = useMutation({
    mutationFn: (id: string) => api.purgePage(id),
    onSuccess: async () => {
      setPurging(null);
      await refreshTrash();
    },
  });
  const empty = useMutation({
    mutationFn: () => api.emptyTrash(space.key),
    onSuccess: async () => {
      setEmptying(false);
      await refreshTrash();
    },
  });

  const head = (count: number) => (
    <div className="page-head">
      <div>
        <h1 className="page-title">Trash</h1>
        {q.data && <p className="muted lead">Pages deleted from {space.name}. {keptFor(q.data.retentionDays)}</p>}
      </div>
      {isAdmin && count > 0 && (
        <button className="btn btn-quiet trash-empty-btn" onClick={() => setEmptying(true)}>
          <Trash2 size={15} aria-hidden="true" /> Empty trash
        </button>
      )}
    </div>
  );

  const forbidden = !canEdit || (q.error instanceof ApiFailure && q.error.status === 403);
  if (forbidden) {
    return (
      <div className="content fade-in">
        <div className="empty">
          <h1 className="empty-title">You cannot see this trash</h1>
          <p className="muted">Only editors and admins of {space.name} can see and restore deleted pages.</p>
          <Link className="btn btn-quiet" to={`/s/${space.key}`}>
            Back to the space
          </Link>
        </div>
      </div>
    );
  }
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const items = q.data.items;

  return (
    <div className="content fade-in">
      {head(items.length)}
      {back && (
        <p className="note trash-note" role="status">
          “{pageTitle(back.title)}” is back in the page tree. <Link to={`/s/${space.key}/p/${back.id}`}>Open it</Link>
        </p>
      )}
      <ErrorNote error={restore.error} />
      {items.length === 0 ? (
        <div className="empty">
          <p className="empty-title">The trash is empty</p>
          <p className="muted">Pages you delete from this space wait here for a while, in case you want them back.</p>
        </div>
      ) : (
        <ul className="trash-list" aria-label="Deleted pages">
          {items.map((it) => (
            <TrashRow
              key={it.id}
              icon={<FileText size={16} />}
              title={pageTitle(it.title)}
              extra={it.subPages > 0 ? `and ${plural(it.subPages, 'sub-page')}` : null}
              deletedAt={it.deletedAt}
              deletedBy={it.deletedBy}
              purgeAt={it.purgeAt}
              leaving={leaving.has(it.id)}
              busy={restore.isPending || leaving.has(it.id)}
              onRestore={() => {
                setBack(null);
                restore.mutate(it.id);
              }}
              onPurge={isAdmin ? () => setPurging({ id: it.id, title: pageTitle(it.title), subPages: it.subPages }) : undefined}
            />
          ))}
        </ul>
      )}
      {purging && (
        <ConfirmForGood
          title={`Delete “${purging.title}” for good?`}
          text={`The page${purging.subPages > 0 ? ` and its ${plural(purging.subPages, 'sub-page')}` : ''}, with ${purging.subPages > 0 ? 'their' : 'its'} history, comments and files, will be removed.`}
          action="Delete for good"
          pending={purge.isPending}
          error={purge.error}
          onConfirm={() => purge.mutate(purging.id)}
          onClose={() => setPurging(null)}
        />
      )}
      {emptying && (
        <ConfirmForGood
          title="Empty the trash?"
          text={`${plural(items.length, 'item')} and every page, version, comment and file in them will be deleted for good.`}
          action="Empty trash"
          pending={empty.isPending}
          error={empty.error}
          onConfirm={() => empty.mutate()}
          onClose={() => setEmptying(false)}
        />
      )}
    </div>
  );
}

/**
 * "Deleted spaces" on Home: the trashed spaces this person may bring back
 * (their space admins, and instance admins). Shows nothing when there are none.
 */
export function DeletedSpaces() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: trashedSpacesKey, queryFn: api.trashedSpaces });
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [back, setBack] = useState<{ key: string; name: string } | null>(null);
  const [purging, setPurging] = useState<{ id: string; name: string } | null>(null);

  const restore = useMutation({
    mutationFn: (s: { id: string; key: string; name: string }) => api.restoreSpace(s.id),
    onSuccess: async (_d, s) => {
      setLeaving((prev) => new Set(prev).add(s.id));
      await qc.invalidateQueries({ queryKey: ['spaces'] });
      afterFade(() => {
        setBack({ key: s.key, name: s.name });
        void qc.invalidateQueries({ queryKey: trashedSpacesKey });
      });
    },
  });
  const purge = useMutation({
    mutationFn: (id: string) => api.purgeSpace(id),
    onSuccess: async () => {
      setPurging(null);
      await qc.invalidateQueries({ queryKey: trashedSpacesKey });
    },
  });

  const items = q.data?.items ?? [];
  if (items.length === 0 && !back) return null;
  return (
    <section className="deleted-spaces" aria-labelledby="home-deleted-spaces">
      <h2 className="section-title" id="home-deleted-spaces">
        Deleted spaces
      </h2>
      <p className="muted small">Spaces moved to the trash. You can bring them back with all their pages.</p>
      {back && (
        <p className="note trash-note" role="status">
          {back.name} is back. <Link to={`/s/${back.key}`}>Open it</Link>
        </p>
      )}
      <ErrorNote error={restore.error} />
      {items.length > 0 && (
        <ul className="trash-list" aria-label="Deleted spaces">
          {items.map((s) => (
            <TrashRow
              key={s.id}
              icon={<FolderOpen size={16} />}
              title={s.name}
              extra={s.key}
              deletedAt={s.deletedAt}
              deletedBy={s.deletedBy}
              purgeAt={s.purgeAt}
              leaving={leaving.has(s.id)}
              busy={restore.isPending || leaving.has(s.id)}
              onRestore={() => {
                setBack(null);
                restore.mutate(s);
              }}
              onPurge={() => setPurging({ id: s.id, name: s.name })}
            />
          ))}
        </ul>
      )}
      {purging && (
        <ConfirmForGood
          title={`Delete “${purging.name}” for good?`}
          text="The space and every page, version, comment, template and file in it will be removed."
          action="Delete for good"
          pending={purge.isPending}
          error={purge.error}
          onConfirm={() => purge.mutate(purging.id)}
          onClose={() => setPurging(null)}
        />
      )}
    </section>
  );
}
