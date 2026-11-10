// Lean suite, row 14 (docs/done-checks/10-e2e-speed.md): what a viewer sees.
// One page holds text, an image with a caption, a file, an uploaded video, a
// YouTube and a Vimeo player and two link cards. The viewer sees all of it,
// with nothing editable, no editor-only control and no way to upload. This
// was four viewer tests (editor, wiki, embeds, video-links); the page is
// made through the API here, since embeds.spec.ts and video-links.spec.ts
// make the same blocks on screen. No test touches the internet: the
// YouTube/Vimeo player requests are blocked.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { afterNextPaint } from '../paint';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'battery horse correct' };
const TITLE = 'Tide tables';

// A 1×1 PNG and a real 16×16, 0.2 s VP8 webm, so the browser can load and play them.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIIEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggE0TbuMU6uEHFO7a1OsggHy7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjMuMTEuMTAwV0GNTGF2ZjYzLjExLjEwMESJiEBpAAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYhMFQ2eHZhwSpyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBELqBEJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn+3NzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjMuMTEuMTAwc3PVY8CLY8WITBUNnh2YcEpnyKBFo4dFTkNPREVSRIeTTGF2YzYzLjIuMTAwIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMjAwMDAwMDAwAB9DtnW554EAo7SBAACAMAIAnQEqEAAQAABHCIWFiIWEiAICAnT0b0+A/vnnAKvV5lX/1lf//Mr//5lf7uwAHFO7a5G7j7OBALeK94EB8YIBtPCBAw==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% a small test file for the download link\n'.repeat(40));

const YT_PLAYER = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=65';
const VIMEO_PLAYER = 'https://player.vimeo.com/video/76979871?dnt=1';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

/** Uploads a file to the page the way the editor's upload does. Returns the attachment's id. */
async function upload(page: Page, pageId: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<string> {
  const res = await page.request.post(`/api/pages/${pageId}/attachments`, { multipart: { file } });
  expect(res.status(), `upload ${file.name}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Fire a paste at the editor the way the browser would; true if nothing took it. */
async function paste(page: Page, item: { file?: { name: string; type: string; base64: string }; text?: string }): Promise<boolean> {
  return body(page).evaluate((el, item) => {
    const dt = new DataTransfer();
    if (item.file) {
      const bytes = Uint8Array.from(atob(item.file.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], item.file.name, { type: item.file.type }));
    }
    if (item.text) dt.setData('text/plain', item.text);
    return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, item);
}

test.describe.serial('a viewer', () => {
  test.beforeAll(resetDatabase);

  test('a viewer sees the page, its image, caption, file, video, players and link cards, with nothing editable and no upload control', async ({
    page,
  }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Ocean Notes', key: 'ocean-notes' });
    const made = await createPage(page, 'ocean-notes', { title: TITLE });
    const image = await upload(page, made.id, { name: 'bay.png', mimeType: 'image/png', buffer: PNG });
    const file = await upload(page, made.id, { name: 'tide-tables.pdf', mimeType: 'application/pdf', buffer: PDF });
    const video = await upload(page, made.id, { name: 'bay.webm', mimeType: 'video/webm', buffer: WEBM });
    const res = await page.request.put(`/api/pages/${made.id}`, {
      data: {
        baseVersion: made.version,
        title: TITLE,
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Hello calm world' }] },
            { type: 'image', attrs: { attachmentId: image, caption: 'Morning at the bay' } },
            { type: 'file', attrs: { attachmentId: file, filename: 'tide-tables.pdf', size: PDF.length, mime: 'application/pdf' } },
            { type: 'video', attrs: { attachmentId: video, filename: 'bay.webm', mime: 'video/webm' } },
            { type: 'video', attrs: { embedUrl: YT_PLAYER } },
            { type: 'video', attrs: { embedUrl: VIMEO_PLAYER } },
            {
              type: 'linkPreview',
              attrs: { url: 'https://almanac.example/tides', title: 'Tide tables for the harbour', siteName: 'Harbour Almanac' },
            },
            { type: 'linkPreview', attrs: { url: 'https://plain.example/' } },
          ],
        },
      },
    });
    expect(res.status(), 'save the page with every embed').toBe(200);
    await addPerson(page, viewer, 'viewer');

    await page.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//, (r) => r.abort());
    await page.context().clearCookies();
    await logIn(page, viewer, '/s/ocean-notes');
    await page.getByRole('main').getByRole('link', { name: TITLE }).click();
    await expect(page).toHaveURL(made.path);

    // Read-only: the title is plain text, the body is not editable.
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(page.getByLabel('Page title')).toHaveCount(0);
    await expect(body(page)).toContainText('Hello calm world');
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('textbox', { name: 'Page content' })).toHaveCount(0);

    // None of the editor-only controls are offered.
    for (const name of ['Sub-page', 'Delete page', 'New page', 'Save as template']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }

    // Image and caption, file with its download link.
    const images = body(page).locator('figure.embed-image img');
    await expect(images).toHaveCount(1);
    await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await expect(body(page).locator('figcaption')).toHaveText('Morning at the bay');
    await expect(page.getByLabel('Image caption')).toHaveCount(0);
    await expect(body(page).getByRole('link', { name: 'Download tide-tables.pdf' })).toBeVisible();

    // The uploaded video plays; both players and both cards are there.
    const player = body(page).locator('.embed-video video');
    await expect(player).toHaveCount(1);
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(16);
    await expect(body(page).locator(`iframe[src="${YT_PLAYER}"]`)).toHaveCount(1);
    await expect(body(page).locator(`iframe[src="${VIMEO_PLAYER}"]`)).toHaveCount(1);
    await expect(body(page).locator('.embed-link')).toHaveCount(2);
    await expect(body(page).locator('.embed-link:not(.is-plain)')).toContainText('Harbour Almanac');

    // No file picker; a pasted file is not uploaded, a pasted link offers no card.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    let uploads = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/attachments')) uploads++;
    });
    expect(await paste(page, { file: { name: 'sneaky.png', type: 'image/png', base64: PNG.toString('base64') } })).toBe(true);
    expect(await paste(page, { text: 'https://another.example/' })).toBe(true);
    // Nothing took either paste, and once the next frame is painted nothing has changed.
    await afterNextPaint(page);
    expect(uploads).toBe(0);
    await expect(images).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Show as preview card' })).toHaveCount(0);
    await expect(body(page).locator('a[href="https://another.example/"]')).toHaveCount(0);

    // The API itself refuses a write and an upload, not just the screen.
    const write = await page.request.put(`/api/pages/${made.id}`, {
      data: { baseVersion: 2, title: 'Hacked', doc: { type: 'doc', content: [] } },
    });
    expect(write.status()).toBe(403);
    const sneak = await page.request.post(`/api/pages/${made.id}/attachments`, {
      multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(sneak.status()).toBe(403);
  });
});
