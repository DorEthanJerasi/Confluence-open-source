// A small in-memory fixed-window limiter for login attempts, keyed by IP and
// by email. One process serves the whole instance, so memory is enough.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records one attempt; returns false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** Takes back one attempt recorded by take(), e.g. once it turned out to be a good login. */
  refund(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (entry && entry.resetAt > now && entry.count > 0) entry.count -= 1;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
