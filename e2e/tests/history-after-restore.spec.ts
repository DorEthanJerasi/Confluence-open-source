// Stage 3c page history, part 4 of 5 (see history-list.spec.ts): typing
// after a restore saves with no conflict note. Starts from what part 3
// leaves behind (two versions and a restore of the first), made through the
// API; the editor then opens the page fresh, as part 3's next visit did.
import { test, expect } from '../fixtures';
import { body, editorB, setUpVersions, switchUser } from '../history-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('history: after a restore', () => {
  test.beforeAll(resetDatabase);

  test('typing after the restore saves cleanly, with no conflict note', async ({ page }) => {
    const { path } = await setUpVersions(page, true);
    await switchUser(page, editorB, path);
    await expect(body(page)).toContainText('first text');
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' and more');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await expect(page.locator('.conflict-note')).toHaveCount(0);
  });
});
