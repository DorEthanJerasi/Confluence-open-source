// Stage 3c page history on screen (docs/done-checks/03-search-history.md, 3c
// E2E): the history panel lists versions with the right names, an earlier
// version opens read-only with its changed block marked, Restore puts the old
// text back and survives a reload, the restore entry sits above the earlier
// ones, typing after a restore saves with no conflict note, and a viewer gets
// the list but no Restore button.
import { test, expect, type Page } from '../fixtures';
import { addPerson, logIn } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };
let pageUrl = '';
// Snapshot folding means version numbers are not simply 1, 2, 3: whichever
// numbers the server actually assigned are read off the panel and reused.
let firstVersion = 0;
let secondVersion = 0;
let restoreVersion = 0;

/** Log in as `user` instead, landing straight on the shared page. */
async function switchUser(page: Page, user: { email: string; password: string }) {
  await page.context().clearCookies();
  await logIn(page, user, pageUrl);
}


const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const panel = (page: Page) => page.getByRole('complementary', { name: 'Page history' });
const row = (page: Page, version: number) => panel(page).locator(`[data-version="${version}"]`);

async function openHistory(page: Page) {
  const toggle = page.getByRole('button', { name: 'History' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(panel(page)).toBeVisible();
}

/**
 * Replaces the paragraph's text in place: selects only the inline content
 * (Home to End), not the whole document, so the block itself (and its id)
 * survives and the diff reports "changed", not a remove plus an add.
 */
async function replaceText(page: Page, text: string) {
  await body(page).click();
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.keyboard.type(text);
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
}

test.describe.serial('history', () => {
  test.beforeAll(resetDatabase);

  test('two editors each save a version, and history lists both with the right names', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password', { exact: false }).fill(admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Open Room');
    await page.getByLabel('Default role').selectOption('editor');
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL('/s/open-room');

    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
    await expect(page).toHaveURL(/\/p\/.+/);
    await page.getByLabel('Page title').fill('Shared notes');
    await page.getByLabel('Page title').blur();
    await body(page).click();
    await page.keyboard.type('first text');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    pageUrl = page.url();

    await addPerson(page, editorB, 'editor');
    await addPerson(page, viewerC, 'viewer');

    await switchUser(page, editorB);
    await replaceText(page, 'second text');

    await openHistory(page);
    const rows = panel(page).locator('.version-row');
    await expect(rows).toHaveCount(2);
    // Newest first: row 0 is editor B's save, row 1 is admin's.
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-version')));
    secondVersion = Number(order[0]);
    firstVersion = Number(order[1]);
    await expect(row(page, secondVersion).locator('.version-author')).toHaveText(editorB.name);
    await expect(row(page, firstVersion).locator('.version-author')).toHaveText(admin.name);
  });

  test('opening the earlier version shows it read-only with the changed block marked', async ({ page }) => {
    await switchUser(page, editorB);
    await openHistory(page);
    await row(page, firstVersion).click();

    const preview = page.locator('.version-preview');
    await expect(preview).toContainText('first text');
    await expect(preview.locator('.diff-block.diff-changed')).toBeVisible();
    await expect(preview.locator('.diff-label-changed')).toHaveText('Changed since this version');
    await expect(preview.getByTestId('diff-summary')).toContainText('changed since this version');
  });

  test('restoring the old version puts its text back, and it survives a reload', async ({ page }) => {
    await switchUser(page, editorB);
    await openHistory(page);
    await row(page, firstVersion).click();

    await page.getByRole('button', { name: 'Restore this version' }).click();
    const dialog = page.getByRole('dialog', { name: 'Restore this version?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(body(page)).toContainText('first text');

    await page.reload();
    await expect(body(page)).toContainText('first text');

    await openHistory(page);
    const rows = panel(page).locator('.version-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(`Restored from version ${firstVersion}`);
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-version')));
    restoreVersion = Number(order[0]);
    expect(order.slice(1)).toEqual([String(secondVersion), String(firstVersion)]);
  });

  test('typing after the restore saves cleanly, with no conflict note', async ({ page }) => {
    await switchUser(page, editorB);
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' and more');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await expect(page.locator('.conflict-note')).toHaveCount(0);
  });

  test('a viewer sees the versions but no Restore button, in light and dark', async ({ page }) => {
    await switchUser(page, viewerC);
    await openHistory(page);
    const rows = panel(page).locator('.version-row');
    await expect(rows.first()).toBeVisible();
    await row(page, restoreVersion).click();
    await expect(page.locator('.version-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore this version' })).toHaveCount(0);

    await page.screenshot({ path: 'test-results/history-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/history-dark.png', fullPage: true });
  });
});
