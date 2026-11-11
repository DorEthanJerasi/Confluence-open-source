// Lean suite, rows 21-24 (docs/done-checks/10-e2e-speed.md): page history on
// screen (docs/done-checks/03-search-history.md, 3c). Two editors each save
// a version and the panel lists both names; the earlier version opens
// read-only with its changed block marked; Restore puts the old text back
// and it survives a reload; typing after the restore saves with no conflict
// note. That a viewer gets no Restore (403) is proven by
// apps/server/test/history.test.ts.
import { test, expect, type Page } from '../fixtures';
import { logIn } from '../login';
import { admin, body, editorB, openHistory, panel, row, setUpSharedPage, TITLE } from '../history-page';
import { resetDatabase } from '../reset-db';

let path = '';
let firstVersion = 0;
let secondVersion = 0;

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
  await page.keyboard.insertText(text);
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
}

test.describe.serial('page history', () => {
  test.beforeAll(resetDatabase);

  test('two editors each save a version, history lists both names, and the earlier one opens read-only with the change marked', async ({
    page,
  }) => {
    // The admin's account, the open space and the page with its first version
    // come from the API (the same calls the forms make); editor B's edit is typed on screen.
    ({ path } = await setUpSharedPage(page));
    await page.context().clearCookies();
    await logIn(page, editorB, path);
    await expect(page.getByLabel('Page title')).toHaveValue(TITLE);
    await replaceText(page, 'second text');

    // Row 21: newest first, row 0 is editor B's save, row 1 is admin's.
    await openHistory(page);
    const rows = panel(page).locator('.version-row');
    await expect(rows).toHaveCount(2);
    // Snapshot folding means version numbers are not simply 1, 2, 3: whichever
    // numbers the server actually assigned are read off the panel.
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-version')));
    secondVersion = Number(order[0]);
    firstVersion = Number(order[1]);
    await expect(row(page, secondVersion).locator('.version-author')).toHaveText(editorB.name);
    await expect(row(page, firstVersion).locator('.version-author')).toHaveText(admin.name);

    // Row 22: the earlier version, read-only, with the changed block marked.
    await row(page, firstVersion).click();
    const preview = page.locator('.version-preview');
    await expect(preview).toContainText('first text');
    await expect(preview.locator('.diff-block.diff-changed')).toBeVisible();
    await expect(preview.locator('.diff-label-changed')).toHaveText('Changed since this version');
    await expect(preview.getByTestId('diff-summary')).toContainText('changed since this version');

    await page.screenshot({ path: 'test-results/history-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/history-dark.png', fullPage: true });
  });

  test('restoring the old version puts its text back, survives a reload, and typing after it saves with no conflict note', async ({
    page,
  }) => {
    await logIn(page, editorB, path);
    await openHistory(page);
    await row(page, firstVersion).click();

    // Row 23: Restore, confirm, the old text is back, and it survives a reload.
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
    expect(order.slice(1)).toEqual([String(secondVersion), String(firstVersion)]);

    // Row 24: typing after the restore saves cleanly.
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' and more');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await expect(page.locator('.conflict-note')).toHaveCount(0);
  });
});
