// The one client-side write path for a page (ARCHITECTURE.md §3, rule 5).
// Title and body changes go through the same queue, so they share one
// version number and never race each other. A stale version (409) stops
// the queue and keeps the unsaved change until the user reloads. A locked
// page (423, done-check 17) stops it the same way: the page then turns
// read-only and shows the unsaved text so it can be copied.
import type { Doc } from '@stillwater/shared';
import { api, ApiFailure } from '../api';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'conflict' | 'locked' | 'error';
type Change = { title?: string; doc?: Doc };

export class PageSaver {
  state: SaveState = 'idle';
  error: unknown = null;
  private pending: Change | null = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly pageId: string,
    public version: number,
    private onSaved: (version: number, change: Change) => void = () => {},
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private set(state: SaveState, error: unknown = null) {
    this.state = state;
    this.error = error;
    this.listeners.forEach((fn) => fn());
  }

  /** Mark that a change is coming (e.g. during the autosave debounce). */
  markPending() {
    if (this.state !== 'conflict' && this.state !== 'locked') this.set('pending');
  }

  /** The change not yet stored, if any (kept after a conflict so nothing is lost). */
  get unsaved(): Change | null {
    return this.pending;
  }

  /** Resolves once no save is running (whether it worked or not). */
  async settled(): Promise<void> {
    while (this.running) await this.running.catch(() => {});
  }

  /** Queue a change; resolves once it (and anything before it) is stored. */
  save(change: Change): Promise<void> {
    this.pending = { ...this.pending, ...change };
    if (this.state === 'conflict') return Promise.reject(new ApiFailure(409, 'stale_version', 'This page was changed elsewhere.'));
    if (this.state === 'locked') return Promise.reject(new ApiFailure(423, 'page_locked', 'This page is locked.'));
    this.running ??= this.drain().finally(() => (this.running = null));
    return this.running;
  }

  private async drain() {
    while (this.pending) {
      const change = this.pending;
      this.pending = null;
      this.set('saving');
      try {
        const { version } = await api.savePage(this.pageId, { baseVersion: this.version, ...change });
        this.version = version;
        this.onSaved(version, change);
      } catch (err) {
        // Keep the change, merged under anything typed since, so it is not lost.
        this.pending = { ...change, ...(this.pending ?? {}) };
        const status = err instanceof ApiFailure ? err.status : 0;
        this.set(status === 409 ? 'conflict' : status === 423 ? 'locked' : 'error', err);
        throw err;
      }
    }
    this.set('saved');
  }
}
