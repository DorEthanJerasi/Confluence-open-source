// Stage 3c page history on screen (docs/done-checks/03-search-history.md, 3c
// E2E), part 1 of 5 (the others are history-preview, -restore,
// -after-restore and -viewer; shared set-up in e2e/history-page.ts). Here:
// two editors each save a version, and the history panel lists both with the
// right names.
import { test, expect, type Page } from '../fixtures';
import { editorB, admin, body, openHistory, panel, row, setUpSharedPage, switchUser } from '../history-page';
import { resetDatabase } from '../reset-db';

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

test.describe.serial('history: the version list', () => {
  test.beforeAll(resetDatabase);

  test('two editors each save a version, and history lists both with the right names', async ({ page }) => {
    // The admin's account, the open space and the page with its first version
    // come from the API (the same calls the forms make); the edit that this
    // test is about, editor B's, is typed on screen.
    const { path } = await setUpSharedPage(page);

    await switchUser(page, editorB, path);
    await replaceText(page, 'second text');

    await openHistory(page);
    const rows = panel(page).locator('.version-row');
    await expect(rows).toHaveCount(2);
    // Newest first: row 0 is editor B's save, row 1 is admin's.
    // Snapshot folding means version numbers are not simply 1, 2, 3: whichever
    // numbers the server actually assigned are read off the panel.
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-version')));
    const secondVersion = Number(order[0]);
    const firstVersion = Number(order[1]);
    await expect(row(page, secondVersion).locator('.version-author')).toHaveText(editorB.name);
    await expect(row(page, firstVersion).locator('.version-author')).toHaveText(admin.name);
  });
});
