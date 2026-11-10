// Item 5a (docs/done-checks/05-loop-criteria.md): per-space permissions and
// nested pages, proven on screen, part 1 of 5 (the others are
// permissions-subpage, -outsider, -member and -removed; shared set-up in
// e2e/permissions-page.ts). Here: Ada adds Eve to the members-only space A
// through the space settings form.
import { test, expect } from '../fixtures';
import { addPerson, createSpace, signUp } from '../login';
import { A, B, ada, eve, otto, sidebar } from '../permissions-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('per-space permissions: space settings', () => {
  test.beforeAll(resetDatabase);

  test('Ada sets up a members-only space with Eve as its editor, and an open space', async ({ page }) => {
    // Accounts and spaces come from the API (the sign-up form and the "New
    // space" dialog are proven in wiki.spec.ts and search.spec.ts); the clicks
    // here are the space settings form, which is what this test is about.
    await signUp(page, ada);
    await addPerson(page, eve, 'editor');
    await addPerson(page, otto, 'editor');
    await createSpace(page, { ...A, visibility: 'restricted' });
    await createSpace(page, { ...B, visibility: 'open' });

    await page.goto(`/s/${A.key}`);
    await expect(sidebar(page).getByLabel('Members only')).toBeVisible();

    // Space settings: add Eve as an editor of A.
    await sidebar(page).getByRole('link', { name: 'Space settings' }).click();
    await expect(page).toHaveURL(`/s/${A.key}/settings`);
    await page.getByLabel('Person to add').selectOption({ label: `${eve.name} (${eve.email})` });
    await page.getByLabel('Role for new member').selectOption('editor');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.member-list')).toContainText(eve.name);
    await expect(page.getByLabel(`Role for ${eve.name}`)).toHaveValue('editor');
    // Otto is not offered as a member yet, and is not one.
    await expect(page.locator('.member-list')).not.toContainText(otto.name);

    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
    await expect(sidebar(page).getByLabel('Members only')).toHaveCount(0);
  });
});
