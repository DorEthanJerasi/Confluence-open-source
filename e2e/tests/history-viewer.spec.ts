// Stage 3c page history, part 5 of 5 (see history-list.spec.ts): a viewer
// gets the version list but no Restore button, in light and dark. Starts
// from what parts 1-4 leave behind (two versions and a restore), made
// through the API.
import { test, expect } from '../fixtures';
import { openHistory, panel, row, setUpVersions, switchUser, viewerC } from '../history-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('history: a viewer', () => {
  test.beforeAll(resetDatabase);

  test('a viewer sees the versions but no Restore button, in light and dark', async ({ page }) => {
    const { path, restoreVersion } = await setUpVersions(page, true);
    await switchUser(page, viewerC, path);
    await openHistory(page);
    const rows = panel(page).locator('.version-row');
    await expect(rows.first()).toBeVisible();
    await row(page, restoreVersion!).click();
    await expect(page.locator('.version-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore this version' })).toHaveCount(0);

    await page.screenshot({ path: 'test-results/history-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/history-dark.png', fullPage: true });
  });
});
