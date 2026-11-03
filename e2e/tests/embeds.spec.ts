// Stage 2b image and file blocks (docs/done-checks/02-editor.md, 2b): upload
// from the slash menu, paste and drag-drop; caption; file name, size and
// download; the stored doc holds only attachment ids; viewers see both blocks
// and have no way to upload.
import { test, expect, type Page } from '@playwright/test';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'battery horse correct' };
let pageUrl = '';

// A 1×1 PNG, as a real image file would arrive from the picker.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% a small test file for the download link\n'.repeat(40));

async function logIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

async function slashPick(page: Page, query: string, pick: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.keyboard.type('/' + query);
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await menu.getByRole('option', { name: new RegExp('^' + pick) }).click();
  await (await chooser).setFiles(file);
}

/** Fire a paste or drop of one file at the editor, the way the browser would. */
async function sendFile(page: Page, kind: 'paste' | 'drop', name: string, type: string, base64: string) {
  await body(page).evaluate(
    (el, { kind, name, type, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type }));
      if (kind === 'paste') {
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } else {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 10 }),
        );
      }
    },
    { kind, name, type, base64 },
  );
}

test.describe.serial('image and file blocks', () => {
  test.beforeAll(resetDatabase);

  test('upload from slash menu, paste and drop; caption; file block; only ids stored', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/signup');
    await page.getByLabel('Name').fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password', { exact: false }).fill(admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Harbour');
    await page.getByRole('button', { name: 'Create space' }).click();
    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
    await expect(page).toHaveURL(/\/p\/.+/);
    pageUrl = page.url();

    await body(page).click();
    await page.keyboard.type('Pictures of the bay');
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
    await sendFile(page, 'drop', 'dropped.png', 'image/png', PNG.toString('base64'));
    await expect(images).toHaveCount(3);

    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await page.reload();
    await expect(body(page).locator('figure.embed-image img')).toHaveCount(3);
    const captions = () => page.getByLabel('Image caption').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await expect.poll(captions).toContain('Morning at the bay');

    await page.screenshot({ path: 'test-results/embeds-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/embeds-dark.png', fullPage: true });

    // The stored doc holds attachment ids only — no file bytes, no URLs.
    const id = pageUrl.split('/p/')[1];
    const { page: p } = await (await page.request.get(`/api/pages/${id}`)).json();
    const embeds = p.doc.content.filter((b: { type: string }) => b.type === 'image' || b.type === 'file');
    expect(embeds).toHaveLength(4);
    for (const b of embeds) {
      expect(b.attrs.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(b.attrs).not.toHaveProperty('src');
    }
    expect(embeds.map((b: { attrs: { caption?: string } }) => b.attrs.caption)).toContain('Morning at the bay');
    expect(embeds.find((b: { type: string }) => b.type === 'file').attrs).toMatchObject({ filename: 'tide-tables.pdf', size: PDF.length });
    expect(JSON.stringify(p.doc)).not.toContain('data:');

    // The download link gives the file back.
    const fileId = embeds.find((b: { type: string }) => b.type === 'file').attrs.attachmentId;
    const dl = await page.request.get(`/api/attachments/${fileId}`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()['content-disposition']).toContain('attachment');
    expect((await dl.body()).equals(PDF)).toBe(true);
  });

  test('viewer sees image, caption and file, and has no upload control', async ({ page }) => {
    await logIn(page, admin);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Add a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await dialog.getByLabel('Name').fill(viewer.name);
    await dialog.getByLabel('Email').fill(viewer.email);
    await dialog.getByLabel('Starting password').fill(viewer.password);
    await dialog.getByLabel('Role').selectOption('viewer');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(viewer.email)).toBeVisible();
    await page.context().clearCookies();

    await logIn(page, viewer);
    await page.goto(pageUrl);
    const images = body(page).locator('figure.embed-image img');
    await expect(images).toHaveCount(3);
    await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await expect(body(page).locator('figcaption')).toHaveText('Morning at the bay');
    await expect(page.getByLabel('Image caption')).toHaveCount(0);
    await expect(body(page).getByRole('link', { name: 'Download tide-tables.pdf' })).toBeVisible();

    // No slash menu, no file picker, and a pasted file is not uploaded.
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    let uploads = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/attachments')) uploads++;
    });
    await sendFile(page, 'paste', 'sneaky.png', 'image/png', PNG.toString('base64'));
    await page.waitForTimeout(500);
    expect(uploads).toBe(0);
    await expect(images).toHaveCount(3);

    // And the API says no.
    const id = pageUrl.split('/p/')[1];
    const res = await page.request.post(`/api/pages/${id}/attachments`, {
      multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(res.status()).toBe(403);
  });
});
