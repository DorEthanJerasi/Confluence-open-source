// Lean suite, row 16 (docs/done-checks/10-e2e-speed.md): video and link
// cards (docs/done-checks/02-editor.md, 2b). An mp4/webm upload plays in the
// page; a pasted YouTube link becomes a youtube-nocookie player and a Vimeo
// link a Vimeo player; other video hosts are refused; a bare link pasted on
// an empty line offers "Show as preview card"; a refused fetch gives a plain
// link card. Which hosts and which cards are allowed, and what is stored, is
// proven by apps/server/test/video.test.ts, linkPreview.test.ts and
// embeds.test.ts; what a viewer sees is viewer.spec.ts.
// No test touches the internet: the YouTube/Vimeo player requests are blocked,
// the refused card uses this test server's own (loopback) address, which the
// server's guard refuses, and the full card uses a stubbed /api/link-preview reply.
import { test, expect, type Page } from '../fixtures';
import { createPage, createSpace, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };

// A real 16×16, 0.2 s VP8 webm, so the browser can actually load and play it.
const WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIIEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggE0TbuMU6uEHFO7a1OsggHy7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjMuMTEuMTAwV0GNTGF2ZjYzLjExLjEwMESJiEBpAAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYhMFQ2eHZhwSpyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBELqBEJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn+3NzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjMuMTEuMTAwc3PVY8CLY8WITBUNnh2YcEpnyKBFo4dFTkNPREVSRIeTTGF2YzYzLjIuMTAwIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMjAwMDAwMDAwAB9DtnW554EAo7SBAACAMAIAnQEqEAAQAABHCIWFiIWEiAICAnT0b0+A/vnnAKvV5lX/1lf//Mr//5lf7uwAHFO7a5G7j7OBALeK94EB8YIBtPCBAw==', 'base64');

const YT_LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s';
const YT_PLAYER = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65';
const VIMEO_LINK = 'https://vimeo.com/76979871';
const VIMEO_PLAYER = 'https://player.vimeo.com/video/76979871?dnt=1';
const CARD_URL = 'https://almanac.example/tides';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

/** Keep the test off the internet: never load the real players. */
async function blockPlayers(page: Page) {
  await page.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//, (r) => r.abort());
}

/** A fresh empty line right after the first paragraph, caret in it. */
async function newLine(page: Page) {
  await body(page).locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}

/**
 * Fire a paste of plain text at the editor, the way the browser would.
 * Resolves to false if a handler took it (the editor calls preventDefault),
 * true if nothing did.
 */
async function pasteText(page: Page, text: string): Promise<boolean> {
  return body(page).evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

async function slash(page: Page, query: string, pick: string) {
  await page.keyboard.type('/' + query);
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  return menu.getByRole('option', { name: new RegExp('^' + pick) });
}

test.describe.serial('video and link cards', () => {
  test.beforeAll(resetDatabase);

  test('upload a video, paste YouTube, add Vimeo, refuse other hosts, link cards', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await blockPlayers(page);
    // Sign-up, the space and the page come through the API (wiki.spec.ts
    // clicks through those forms); this test is about the embeds.
    await signUp(page, admin);
    await createSpace(page, { name: 'Harbour', key: 'harbour' });
    await page.goto((await createPage(page, 'harbour', { title: 'Films', text: 'Films of the bay' })).path);

    // Slash menu → Video: an uploaded webm plays in a <video>.
    await newLine(page);
    const chooser = page.waitForEvent('filechooser');
    await (await slash(page, 'vid', 'Video')).first().click();
    await (await chooser).setFiles({ name: 'bay.webm', mimeType: 'video/webm', buffer: WEBM });
    const video = body(page).locator('.embed-video video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute('src', /^\/api\/attachments\/[0-9a-f-]{36}$/);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(16);
    await video.evaluate((v: HTMLVideoElement) => void v.play().catch(() => {}));
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime > 0 || v.ended)).toBe(true);

    // Pasting a YouTube link on an empty line gives a youtube-nocookie player.
    await newLine(page);
    await pasteText(page, YT_LINK);
    const frames = body(page).locator('.embed-video iframe');
    await expect(frames).toHaveCount(1);
    await expect(frames.first()).toHaveAttribute('src', YT_PLAYER);

    // Slash menu → Video link: Vimeo becomes a Vimeo player…
    await newLine(page);
    page.once('dialog', (d) => d.accept(VIMEO_LINK));
    await (await slash(page, 'youtube', 'Video link')).click();
    await expect(frames).toHaveCount(2);
    await expect(body(page).locator(`iframe[src="${VIMEO_PLAYER}"]`)).toHaveCount(1);

    // …and any other host is refused, with a plain note.
    await newLine(page);
    page.once('dialog', (d) => d.accept('https://videos.example.com/watch/42'));
    await (await slash(page, 'youtube', 'Video link')).click();
    await expect(page.getByText('Only YouTube and Vimeo links can be shown as a video')).toBeVisible();
    await expect(frames).toHaveCount(2);
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // A bare link on an empty line goes in as a link and offers a card. Esc says no thanks.
    await body(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await pasteText(page, 'https://keep.example/as-a-link');
    const offer = page.getByRole('button', { name: 'Show as preview card' });
    await expect(offer).toBeVisible();
    await expect(body(page).locator('a[href="https://keep.example/as-a-link"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(offer).toHaveCount(0);

    // This server's own address is refused by the guard: a plain link card, no error.
    const refused = `${baseURL}/internal`;
    await newLine(page);
    await pasteText(page, refused);
    await offer.click();
    const plain = body(page).locator('.embed-link.is-plain');
    await expect(plain).toHaveCount(1);
    await expect(plain.getByRole('link')).toHaveAttribute('href', refused);
    await expect(plain).toContainText(refused);

    // A page with Open Graph data gives the full card (the server reply is stubbed here).
    await page.route('**/api/link-preview?**', (r) =>
      r.fulfill({
        json: {
          url: CARD_URL,
          title: 'Tide tables for the harbour',
          description: 'High and low water for every day of the year.',
          siteName: 'Harbour Almanac',
          imageUrl: null,
        },
      }),
    );
    await newLine(page);
    await pasteText(page, CARD_URL);
    await offer.click();
    const rich = body(page).locator('.embed-link:not(.is-plain)');
    await expect(rich).toHaveCount(1);
    await expect(rich).toContainText('Tide tables for the harbour');
    await expect(rich).toContainText('High and low water');
    await expect(rich).toContainText('Harbour Almanac');
    await page.unroute('**/api/link-preview?**');

    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
    await page.reload();
    await expect(body(page).locator('.embed-video video')).toHaveCount(1);
    await expect(body(page).locator('.embed-video iframe')).toHaveCount(2);
    await expect(body(page).locator('.embed-link')).toHaveCount(2);
    await expect(body(page).locator('.embed-link:not(.is-plain)')).toContainText('Harbour Almanac');

    await page.screenshot({ path: 'test-results/video-links-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/video-links-dark.png', fullPage: true });

    // The video is served inline with its own type.
    const res = await page.request.get((await body(page).locator('.embed-video video').getAttribute('src'))!);
    expect(res.headers()['content-type']).toBe('video/webm');
    expect(res.headers()['content-disposition'] ?? '').not.toContain('attachment;');
  });
});
