// Item 5a, part 3 of 5 (see permissions-settings.spec.ts): Otto, an editor
// outside the members-only space A, cannot see it in the list, by URL or
// through the API; and logging out and back in through the form works.
// Starts from what parts 1 and 2 leave behind, made through the API
// (setUpHarbour).
import { test, expect } from '../fixtures';
import { logIn, logInWithForm } from '../login';
import { A, B, PARENT, expectRefused, otto, pageIdOf, setUpHarbour, sidebar } from '../permissions-page';
import { resetDatabase } from '../reset-db';

let parentUrl = '';
let childUrl = '';

test.describe.serial('per-space permissions: outside the space', () => {
  test.beforeAll(resetDatabase);

  test('Otto, outside the space, cannot see it in the list, by URL, or through the API', async ({ page }) => {
    ({ parentUrl, childUrl } = await setUpHarbour(page));
    await page.context().clearCookies();
    await logIn(page, otto);

    // Home: the open space is there, the members-only one is not.
    const cards = page.locator('.cards');
    await expect(cards.getByRole('link', { name: new RegExp(B.name) })).toBeVisible();
    await expect(cards.getByRole('link', { name: new RegExp(A.name) })).toHaveCount(0);
    await expect(page.getByText(A.name)).toHaveCount(0);

    // Open space B works for him, and its sidebar does not leak A.
    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
    await expect(sidebar(page)).not.toContainText(A.name);

    // A's space, page and sub-page URLs all land on the calm not-found screen.
    for (const url of [`/s/${A.key}`, parentUrl, childUrl]) {
      await page.goto(url);
      await expectRefused(page);
    }

    // The API agrees: a space you cannot read does not exist for you.
    for (const url of [parentUrl, childUrl]) {
      const res = await page.request.get(`/api/pages/${pageIdOf(url)}`);
      expect(res.status()).toBe(404);
      expect(await res.text()).not.toContain(PARENT);
    }
    const write = await page.request.put(`/api/pages/${pageIdOf(parentUrl)}`, {
      data: { baseVersion: 1, title: 'Taken over', doc: { type: 'doc', content: [] } },
    });
    expect(write.status()).toBe(404);
  });

  test('logging out ends the session, and logging back in restores it', async ({ page }) => {
    await logInWithForm(page, otto);
    await expect(page.locator('.who-name')).toHaveText(otto.name);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL('/login');

    // The session is really gone: the app sends you back, the API refuses.
    await page.goto(`/s/${B.key}`);
    await expect(page).toHaveURL('/login');
    const me = await page.request.get('/api/spaces');
    expect(me.status()).toBe(401);

    await logInWithForm(page, otto);
    await expect(page.locator('.who-name')).toHaveText(otto.name);
    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
  });
});
