// Lean suite, rows 6-7 (docs/done-checks/10-e2e-speed.md): per-space
// permissions on screen. Ada adds Eve to the members-only space A through the
// space settings form, and Otto, an editor outside A, does not see it in his
// list or by URL. People, spaces and pages come from the API (the sign-up
// form and the "New space" dialog are wiki.spec.ts). What the API itself
// refuses (rows 7-9) is proven by apps/server/test/spaces.test.ts,
// pages.test.ts and personal.test.ts.
import { test, expect } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { A, B, CHILD, PARENT, ada, eve, expectRefused, otto, sidebar } from '../permissions-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('per-space permissions', () => {
  test.beforeAll(resetDatabase);

  test('Ada adds Eve to a members-only space in its settings; Otto, outside it, sees neither it nor its pages', async ({ page }) => {
    await signUp(page, ada);
    await addPerson(page, eve, 'editor');
    await addPerson(page, otto, 'editor');
    await createSpace(page, { ...A, visibility: 'restricted' });
    await createSpace(page, { ...B, visibility: 'open' });
    const parent = await createPage(page, A.key, { title: PARENT });
    const child = await createPage(page, A.key, { title: CHILD, parentId: parent.id });

    // Row 6: space settings, add Eve as an editor of A.
    await page.goto(`/s/${A.key}`);
    await expect(sidebar(page).getByLabel('Members only')).toBeVisible();
    await sidebar(page).getByRole('link', { name: 'Space settings' }).click();
    await expect(page).toHaveURL(`/s/${A.key}/settings`);
    await page.getByLabel('Person to add').selectOption({ label: `${eve.name} (${eve.email})` });
    await page.getByLabel('Role for new member').selectOption('editor');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.member-list')).toContainText(eve.name);
    await expect(page.getByLabel(`Role for ${eve.name}`)).toHaveValue('editor');
    // Otto is not a member.
    await expect(page.locator('.member-list')).not.toContainText(otto.name);

    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
    await expect(sidebar(page).getByLabel('Members only')).toHaveCount(0);

    // Row 7: Otto. Home lists the open space, not the members-only one.
    await page.context().clearCookies();
    await logIn(page, otto);
    const cards = page.locator('.cards');
    await expect(cards.getByRole('link', { name: new RegExp(B.name) })).toBeVisible();
    await expect(cards.getByRole('link', { name: new RegExp(A.name) })).toHaveCount(0);
    await expect(page.getByText(A.name)).toHaveCount(0);

    // Open space B works for him, and its sidebar does not leak A.
    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
    await expect(sidebar(page)).not.toContainText(A.name);

    // A's space, page and sub-page URLs all land on the calm not-found screen.
    for (const url of [`/s/${A.key}`, parent.path, child.path]) {
      await page.goto(url);
      await expectRefused(page);
    }
  });
});
