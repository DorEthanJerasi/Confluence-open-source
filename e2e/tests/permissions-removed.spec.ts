// Item 5a, part 5 of 5 (see permissions-settings.spec.ts): when Ada removes
// Eve from the members-only space A in its settings, Eve loses it after a
// reload. Two browsers at once. Starts from what parts 1 and 2 leave behind,
// made through the API (setUpHarbour).
import { test, expect } from '../fixtures';
import { A, B, PARENT, ada, eve, expectRefused, pageIdOf, session, setUpHarbour } from '../permissions-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('per-space permissions: removal', () => {
  test.beforeAll(resetDatabase);

  test('when Ada removes Eve from the space, Eve loses it after a reload', async ({ browser, page }) => {
    const { parentUrl, childUrl } = await setUpHarbour(page);
    const asEve = await session(browser, eve);
    const asAda = await session(browser, ada);
    try {
      await asEve.page.goto(parentUrl);
      await expect(asEve.page.getByLabel('Page title')).toHaveValue(PARENT);

      await asAda.page.goto(`/s/${A.key}/settings`);
      await asAda.page.getByRole('button', { name: `Remove ${eve.name}` }).click();
      await expect(asAda.page.locator('.member-list')).not.toContainText(eve.name);

      await asEve.page.reload();
      await expectRefused(asEve.page);
      await asEve.page.goto(childUrl);
      await expectRefused(asEve.page);
      const res = await asEve.page.request.get(`/api/pages/${pageIdOf(parentUrl)}`);
      expect(res.status()).toBe(404);

      await asEve.page.goto('/');
      await expect(asEve.page.locator('.cards').getByRole('link', { name: new RegExp(B.name) })).toBeVisible();
      await expect(asEve.page.getByText(A.name)).toHaveCount(0);
    } finally {
      await asEve.context.close();
      await asAda.context.close();
    }
  });
});
