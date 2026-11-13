// Lean suite, row 15 (docs/done-checks/10-e2e-speed.md): image and file
// blocks (docs/done-checks/02-editor.md, 2b). Upload from the slash menu,
// paste and drag-drop; caption; file name, size and download. "The stored
// doc holds only attachment ids" is proven by apps/server/test/embeds.test.ts;
// what a viewer sees is viewer.spec.ts.
import { test, expect, type Page } from '../fixtures';
import { createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };

// A 1×1 PNG, as a real image file would arrive from the picker.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% a small test file for the download link\n'.repeat(40));

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

/**
 * Waits for a save that starts *after* this call, not a "Saved" label left
 * over from an earlier save. The status text is the same ("Saving…") for
 * the editor's `pending` and `saving` states, so seeing it once the change
 * is made proves the new save has begun before we wait for it to finish.
 */
async function waitForFreshSave(page: Page) {
  await expect(page.locator('.save-status')).toHaveText('Saving…', { timeout: 10_000 });
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
}

async function slashPick(page: Page, query: string, pick: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.keyboard.type('/' + query);
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await menu.getByRole('option', { name: new RegExp('^' + pick) }).click();
  await (await chooser).setFiles(file);
}

/**
 * Fire a paste or drop of one file at the editor, the way the browser would.
 * Resolves to false if a handler took the event (the editor's upload calls
 * preventDefault), true if nothing did.
 */
async function sendFile(page: Page, kind: 'paste' | 'drop', name: string, type: string, base64: string): Promise<boolean> {
  return body(page).evaluate(
    (el, { kind, name, type, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      if (kind === 'paste') {
        return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
      const r = el.getBoundingClientRect();
      return el.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 10 }),
      );
    },
    { kind, name, type, base64 },
  );
}

test.describe.serial('image and file blocks', () => {
  test.beforeAll(resetDatabase);

  test('upload from slash menu, paste and drop; caption; file block', async ({ page }) => {
    test.setTimeout(90_000);
    // Sign-up, the space and the empty page come through the API (wiki.spec.ts
    // clicks through those forms); this test is about the embeds.
    await signUp(page, admin);
    await createSpace(page, { name: 'Harbour', key: 'harbour' });
    await page.goto((await createPage(page, 'harbour', { title: 'Pictures' })).path);

    await body(page).click();
    await page.keyboard.insertText('Pictures of the bay');
    await page.keyboard.press('Enter');

    // Slash menu → Image
    await slashPick(page, 'imag', 'Image', { name: 'bay.png', mimeType: 'image/png', buffer: PNG });
    const images = body(page).locator('figure.embed-image img');
    await expect(images).toHaveCount(1);
    await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

    // Optional caption
    await page.getByLabel('Image caption').first().fill('Morning at the bay');

    // Slash menu → File
    await body(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await slashPick(page, 'file', 'File', { name: 'tide-tables.pdf', mimeType: 'application/pdf', buffer: PDF });
    const fileBlock = body(page).locator('.embed-file');
    await expect(fileBlock).toHaveCount(1);
    await expect(fileBlock).toContainText('tide-tables.pdf');
    await expect(fileBlock).toContainText(/KB|bytes/);
    await expect(fileBlock.getByRole('link', { name: 'Download tide-tables.pdf' })).toHaveAttribute('href', /^\/api\/attachments\//);

    // Paste and drop an image
    await body(page).locator('p').first().click();
    await sendFile(page, 'paste', 'pasted.png', 'image/png', PNG.toString('base64'));
    await expect(images).toHaveCount(2);
    await waitForFreshSave(page);
    await sendFile(page, 'drop', 'dropped.png', 'image/png', PNG.toString('base64'));
    await expect(images).toHaveCount(3);

    await waitForFreshSave(page);
    await page.reload();
    await expect(body(page).locator('figure.embed-image img')).toHaveCount(3);
    const captions = () => page.getByLabel('Image caption').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await expect.poll(captions).toContain('Morning at the bay');

    await page.screenshot({ path: 'test-results/embeds-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/embeds-dark.png', fullPage: true });

    // The download link gives the file back.
    const href = await body(page).getByRole('link', { name: 'Download tide-tables.pdf' }).getAttribute('href');
    const dl = await page.request.get(href!);
    expect(dl.status()).toBe(200);
    expect(dl.headers()['content-disposition']).toContain('attachment');
    expect((await dl.body()).equals(PDF)).toBe(true);
  });

  // Item #154: on a page that ends with an image, video or link card,
  // Ctrl+End then Enter must start a new line *below* the card (the final
  // walk saw it land above). Keyboard only: no click near the card.
  test('Ctrl+End then Enter after a last-place card writes below it', async ({ page }) => {
    await logIn(page, admin, null);
    const made = await createPage(page, 'harbour', { title: 'Cards at the end', text: 'Intro' });
    const up = await page.request.post(`/api/pages/${made.id}/attachments`, {
      multipart: { file: { name: 'end.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(up.status()).toBe(201);
    const imageId = ((await up.json()) as { id: string }).id;
    const cards = [
      { type: 'image', attrs: { attachmentId: imageId, caption: '' } },
      { type: 'video', attrs: { embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' } },
      { type: 'linkPreview', attrs: { url: 'https://almanac.example/tides', title: 'Tides' } },
    ];
    // Never load the real player: this test stays off the internet.
    await page.route(/^https:\/\/www\.youtube-nocookie\.com\//, (r) => r.abort());
    for (const card of cards) {
      const intro = { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] };
      const res = await page.request.put(`/api/pages/${made.id}`, {
        data: { baseVersion: made.version, doc: { type: 'doc', content: [intro, card] } },
      });
      expect(res.status(), `save a page ending with ${card.type}`).toBe(200);
      made.version = ((await res.json()) as { version: number }).version;

      await page.goto(made.path);
      const blocks = body(page).locator(':scope > *');
      await expect(blocks).toHaveCount(2);
      await body(page).press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(`After the ${card.type}`);
      await expect(blocks, `${card.type}: one new block`).toHaveCount(3);
      // In the editor each card is drawn by its own view, a wrapper with class node-<type>.
      await expect(blocks.nth(1), `${card.type} stays in second place`).toHaveClass(new RegExp(`\\bnode-${card.type}\\b`));
      await expect(blocks.nth(2), `${card.type}: the new line is below the card`).toHaveText(`After the ${card.type}`);
      await waitForFreshSave(page);
      const now = await page.request.get(`/api/pages/${made.id}`);
      made.version = ((await now.json()) as { page: { version: number } }).page.version;
    }
  });
});
