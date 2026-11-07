import type { Page } from './fixtures';

/**
 * Resolves once the browser has painted a frame after this call: two
 * requestAnimationFrame callbacks, the first just before the next paint and
 * the second just before the one after it. Use it where a test fires an
 * event that must change nothing (a viewer's paste): anything the event set
 * off on screen or on the network has had its frame, so "still nothing" can
 * be checked without guessing a fixed number of milliseconds.
 */
export async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}
