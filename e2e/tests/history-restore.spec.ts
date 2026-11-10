// Stage 3c page history, part 3 of 5 (see history-list.spec.ts): Restore
// puts the old text back and survives a reload, and the restore entry sits
// above the earlier ones. Starts from what part 1 leaves behind (two
// versions), made through the API.
import { test, expect } from '../fixtures';
import { body, editorB, openHistory, panel, row, setUpVersions, switchUser } from '../history-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('history: restore', () => {
  test.beforeAll(resetDatabase);

  test('restoring the old version puts its text back, and it survives a reload', async ({ page }) => {
    const v = await setUpVersions(page);
    await switchUser(page, editorB, v.path);
    await openHistory(page);
    await row(page, v.firstVersion).click();

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
    await expect(rows.nth(0)).toContainText(`Restored from version ${v.firstVersion}`);
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-version')));
    expect(order.slice(1)).toEqual([String(v.secondVersion), String(v.firstVersion)]);
  });
});
