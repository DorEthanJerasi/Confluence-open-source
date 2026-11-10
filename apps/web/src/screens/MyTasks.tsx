// My tasks (docs/done-checks/12-tasks.md, 12b): the person's open tasks on
// pages they can read now, grouped by when they are due. Ticking one saves its
// page the normal way (PATCH /api/pages/:id/tasks/:taskId): the box ticks at
// once, the row fades out after a short pause, and a note offers Undo.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyTask } from '@stillwater/shared';
import { api, ApiFailure, errorMessage } from '../api';
import { pageTitle } from '../tree';
import { dueInfo, localToday, myTasksKey } from '../tasks';
import { ErrorNote, Loading } from '../ui';

/** How long a ticked row stays before it fades. */
const PAUSE_MS = 700;
/** Matches --motion-slow: the fade-out. */
const LEAVE_MS = 320;
/** How long the Undo note stays. */
const UNDO_MS = 8000;

const keyOf = (t: { pageId: string; taskId: string }) => `${t.pageId}:${t.taskId}`;
const CONFLICT = 'The page just changed, try again.';
const VIEW_ONLY = 'You can view this page but not edit it';

function reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

type Group = { id: string; title: string; tasks: MyTask[] };

function groupTasks(tasks: MyTask[], today: string): Group[] {
  const groups: Group[] = [
    { id: 'overdue', title: 'Overdue', tasks: [] },
    { id: 'today', title: 'Today', tasks: [] },
    { id: 'later', title: 'Coming up', tasks: [] },
    { id: 'none', title: 'No date', tasks: [] },
  ];
  for (const t of tasks) {
    const g = !t.due ? 3 : (() => {
      const d = dueInfo(t.due, false, today).days;
      return d < 0 ? 0 : d === 0 ? 1 : 2;
    })();
    groups[g]!.tasks.push(t);
  }
  return groups.filter((g) => g.tasks.length > 0);
}

function TaskRow(props: {
  task: MyTask;
  today: string;
  ticked: boolean;
  leaving: boolean;
  busy: boolean;
  error: string | null;
  onTick: () => void;
}) {
  const { task } = props;
  const text = task.text || 'Untitled task';
  const due = task.due ? dueInfo(task.due, false, props.today) : null;
  const hintId = `mytask-hint-${task.pageId}-${task.taskId}`;
  return (
    <li className={`mytask${props.leaving ? ' is-leaving' : ''}${props.ticked ? ' is-ticked' : ''}`}>
      <input
        type="checkbox"
        className="mytask-box"
        checked={props.ticked}
        disabled={!task.canTick || props.busy}
        aria-label={`Done: ${text}`}
        aria-describedby={task.canTick ? undefined : hintId}
        title={task.canTick ? undefined : VIEW_ONLY}
        onChange={() => !props.ticked && props.onTick()}
      />
      <div className="mytask-text">
        <span className="mytask-title">{text}</span>
        <span className="mytask-meta small">
          <Link to={`/s/${task.space.key}/p/${task.pageId}`} className="mytask-link">
            {task.space.name} · {pageTitle(task.page.title)}
          </Link>
          {!task.canTick && (
            <span id={hintId} className="muted">
              {VIEW_ONLY}
            </span>
          )}
        </span>
        {props.error && (
          <span className="mytask-error small" role="alert">
            {props.error}
          </span>
        )}
      </div>
      {due && (
        <span className="task-chip task-due" data-tone={due.tone} title={due.full}>
          <span className="sr-only">Due </span>
          {due.text}
        </span>
      )}
    </li>
  );
}

/** /tasks */
export function MyTasksScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: myTasksKey, queryFn: api.myTasks });
  const [today] = useState(localToday);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [undo, setUndo] = useState<MyTask | null>(null);
  const [undoError, setUndoError] = useState<unknown>(null);
  const undoTimer = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  const edit = <T,>(set: Dispatch<SetStateAction<Set<T>>>, k: T, on: boolean) =>
    set((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const setError = (k: string, msg: string | null) =>
    setErrors((m) => {
      const n = new Map(m);
      if (msg) n.set(k, msg);
      else n.delete(k);
      return n;
    });

  const showUndo = (t: MyTask | null) => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    setUndo(t);
    setUndoError(null);
    if (t) undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  };

  const tick = async (t: MyTask) => {
    const k = keyOf(t);
    setError(k, null);
    edit(setTicked, k, true);
    try {
      await api.tickTask(t.pageId, t.taskId, true);
    } catch (err) {
      if (!alive.current) return;
      edit(setTicked, k, false);
      setError(k, err instanceof ApiFailure && err.status === 409 ? CONFLICT : errorMessage(err));
      return;
    }
    if (!alive.current) return;
    // The page changed: its version and history are new.
    void qc.invalidateQueries({ queryKey: ['page', t.pageId] });
    const fade = () => {
      edit(setLeaving, k, true);
      const done = () => {
        if (!alive.current) return;
        edit(setGone, k, true);
        edit(setLeaving, k, false);
        showUndo(t);
      };
      if (reduceMotion()) done();
      else window.setTimeout(done, LEAVE_MS);
    };
    window.setTimeout(fade, reduceMotion() ? 0 : PAUSE_MS);
  };

  const undoTick = async (t: MyTask) => {
    const k = keyOf(t);
    setUndoError(null);
    try {
      await api.tickTask(t.pageId, t.taskId, false);
    } catch (err) {
      setUndoError(err instanceof ApiFailure && err.status === 409 ? new Error(CONFLICT) : err);
      return;
    }
    await qc.invalidateQueries({ queryKey: myTasksKey });
    void qc.invalidateQueries({ queryKey: ['page', t.pageId] });
    edit(setGone, k, false);
    edit(setTicked, k, false);
    showUndo(null);
  };

  const head = (
    <div className="page-head">
      <div>
        <h1 className="page-title">My tasks</h1>
        <p className="muted lead">Open tasks given to you, on pages you can open.</p>
      </div>
    </div>
  );

  if (q.isPending) return <Loading />;
  if (q.error) {
    return (
      <div className="content fade-in">
        {head}
        <ErrorNote error={q.error} />
      </div>
    );
  }
  const tasks = q.data.tasks.filter((t) => !gone.has(keyOf(t)));
  const groups = groupTasks(tasks, today);

  return (
    <div className="content fade-in">
      {head}
      <div className="mytask-note-slot" aria-live="polite">
        {undo && (
          <p className="note mytask-undo" role="status">
            <span>Ticked “{undo.text || 'Untitled task'}”.</span>
            <button className="btn btn-quiet btn-sm" onClick={() => void undoTick(undo)}>
              Undo
            </button>
          </p>
        )}
      </div>
      <ErrorNote error={undoError} />
      {groups.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No open tasks for you</p>
          <p className="muted">
            To give someone a task, open a page, type <kbd>/</kbd> and choose “Task list”, then pick Assign on the task.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} className={`mytask-group mytask-group-${g.id}`} aria-labelledby={`mytask-group-${g.id}`}>
            <h2 className="section-title" id={`mytask-group-${g.id}`}>
              {g.title} <span className="muted mytask-count">{g.tasks.length}</span>
            </h2>
            <ul className="mytask-list" aria-label={`${g.title} tasks`}>
              {g.tasks.map((t) => {
                const k = keyOf(t);
                return (
                  <TaskRow
                    key={k}
                    task={t}
                    today={today}
                    ticked={ticked.has(k)}
                    leaving={leaving.has(k)}
                    busy={ticked.has(k)}
                    error={errors.get(k) ?? null}
                    onTick={() => void tick(t)}
                  />
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
