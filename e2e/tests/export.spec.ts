// Export on screen (docs/done-checks/16-export.md, 16b). A viewer opens a page
// with one sub-page, opens Export, sees both choices, and downloads the page
// with its sub-page as PDF (a .pdf that starts with %PDF-) and as Markdown (a
// .zip that holds two .md files). What goes into the files is proven by the
// server tests; this proves only the screen and the real download.
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'horse battery correct' };

async function pick(page: Page, format: 'PDF' | 'Markdown') {
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: format, exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path) };
}

test.describe.serial('export', () => {
  test.beforeAll(resetDatabase);

  test('a viewer exports a page with its sub-page as a PDF and as a Markdown zip', async ({ page }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Garden', key: 'garden', defaultRole: 'viewer' });
    const root = await createPage(page, 'garden', { title: 'Field notes', text: 'Watering rota.' });
    await createPage(page, 'garden', { title: 'Greenhouse', text: 'Vents open at nine.', parentId: root.id });
    await addPerson(page, viewer, 'viewer');

    await logIn(page, viewer, root.path);
    await page.getByRole('button', { name: 'Export' }).click();
    const menu = page.getByRole('menu', { name: 'Export this page' });
    await expect(menu.getByRole('menuitemradio', { name: 'This page only' })).toBeVisible();
    await menu.getByRole('menuitemradio', { name: 'This page and its 1 sub-page' }).click();
    await expect(menu.getByRole('menuitemradio', { name: 'This page and its 1 sub-page' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const pdf = await pick(page, 'PDF');
    expect(pdf.name).toMatch(/\.pdf$/);
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitemradio', { name: 'This page and its 1 sub-page' }).click();
    const md = await pick(page, 'Markdown');
    expect(md.name).toMatch(/\.zip$/);
    const files = Object.keys(unzipSync(new Uint8Array(md.bytes))).filter((n) => n.endsWith('.md'));
    expect(files).toHaveLength(2);
  });
});
