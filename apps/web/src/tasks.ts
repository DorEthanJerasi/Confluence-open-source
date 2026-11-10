// Task dates and people as the screen shows them (docs/done-checks/12-tasks.md, 12b).
// A due date is a calendar day (`YYYY-MM-DD`, no time zone); "Overdue",
// "Today" and "Tomorrow" are worked out against the person's own date.

export const myTasksKey = ['me', 'tasks'] as const;
export const spacePeopleKey = (key: string) => ['space-people', key] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The person's own date today, as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'done';

export interface DueInfo {
  /** What the chip says, in words: "Overdue · 3 Nov", "Today", "Tomorrow", "Fri 14 Nov". */
  text: string;
  /** The full date, for a title or screen reader. */
  full: string;
  tone: DueTone;
  /** Days from today: negative is overdue. */
  days: number;
}

/** How a due date reads. A ticked task's date is never "Overdue". */
export function dueInfo(due: string, checked = false, today: string = localToday()): DueInfo {
  const days = dayNumber(due) - dayNumber(today);
  const at = new Date(dayNumber(due) * DAY_MS);
  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  const short = at.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const full = at.toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'full' });
  if (checked) return { text: short, full, tone: 'done', days };
  if (days < 0) return { text: `Overdue · ${short}`, full, tone: 'overdue', days };
  if (days === 0) return { text: 'Today', full, tone: 'today', days };
  if (days === 1) return { text: 'Tomorrow', full, tone: 'soon', days };
  return { text: short, full, tone: 'later', days };
}

/** What a person the editor cannot name (left the space, disabled, unknown) shows as. */
export const NO_ACCESS = 'No access';
