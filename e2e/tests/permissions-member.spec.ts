// Item 5a, part 4 of 5 (see permissions-settings.spec.ts): Eve, an editor of
// the members-only space A, opens and edits its page and sub-page. Starts
// from what parts 1 and 2 leave behind, made through the API (setUpHarbour).
import { test, expect } from '../fixtures';
import { logIn } from '../login';
import { A, body, eve, setUpHarbour, sidebar } from '../permissions-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('per-space permissions: a member edits', () => {
  test.beforeAll(resetDatabase);

  test('Eve, an editor of the space, opens and edits its page and sub-page', async ({ page }) => {
    const { parentUrl, childUrl } = await setUpHarbour(page);
    await page.context().clearCookies();
    await logIn(page, eve);
    await expect(page.locator('.cards').getByRole('link', { name: new RegExp(A.name) })).toBeVisible();

    await page.goto(`/s/${A.key}`);
    await expect(sidebar(page).locator('.sidebar-foot .pill')).toHaveText('Editor');

    for (const [url, word] of [
      [parentUrl, 'anchorage'],
      [childUrl, 'starboard'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByLabel('Page title')).toBeEditable();
      await body(page).click();
      await page.keyboard.type(`Eve wrote ${word}`);
      await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
      await page.reload();
      await expect(body(page)).toContainText(`Eve wrote ${word}`);
    }
  });
});
