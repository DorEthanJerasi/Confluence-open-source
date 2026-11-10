// Stage 3c page history, part 2 of 5 (see history-list.spec.ts): an earlier
// version opens read-only with its changed block marked. Starts from what
// part 1 leaves behind (two versions by two people), made through the API.
import { test, expect } from '../fixtures';
import { editorB, openHistory, row, setUpVersions, switchUser } from '../history-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('history: an earlier version', () => {
  test.beforeAll(resetDatabase);

  test('opening the earlier version shows it read-only with the changed block marked', async ({ page }) => {
    const { path, firstVersion } = await setUpVersions(page);
    await switchUser(page, editorB, path);
    await openHistory(page);
    await row(page, firstVersion).click();

    const preview = page.locator('.version-preview');
    await expect(preview).toContainText('first text');
    await expect(preview.locator('.diff-block.diff-changed')).toBeVisible();
    await expect(preview.locator('.diff-label-changed')).toHaveText('Changed since this version');
    await expect(preview.getByTestId('diff-summary')).toContainText('changed since this version');
  });
});
