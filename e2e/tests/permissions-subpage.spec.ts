// Item 5a, part 2 of 5 (see permissions-settings.spec.ts): a sub-page made
// with the Sub-page button sits under its parent in the tree. Starts from
// what part 1 leaves behind, made through the API (setUpSpaces).
import { test, expect } from '../fixtures';
import { createPage, pickBlankPage } from '../login';
import { A, CHILD, PARENT, setTitle, setUpSpaces, sidebar } from '../permissions-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('per-space permissions: nested pages', () => {
  test.beforeAll(resetDatabase);

  test('a sub-page sits under its parent in the tree and reopens by its URL', async ({ page }) => {
    // The spaces and the parent come from the API; the sub-page is made with
    // the Sub-page button, the click this test is about.
    await setUpSpaces(page); // leaves Ada logged in
    const parentUrl = (await createPage(page, A.key, { title: PARENT })).path;
    await page.goto(parentUrl);
    await expect(page.getByLabel('Page title')).toHaveValue(PARENT);

    await page.getByRole('button', { name: 'Sub-page', exact: true }).click();
    await pickBlankPage(page);
    await expect(page).not.toHaveURL(parentUrl);
    await expect(page).toHaveURL(new RegExp(`/s/${A.key}/p/.+`));
    await setTitle(page, CHILD);
    const childUrl = page.url();

    // In the tree, the child link lives inside the parent's nested list.
    const parentRow = sidebar(page).locator('li', { has: page.getByRole('link', { name: PARENT, exact: true }) }).first();
    const nested = parentRow.locator('.tree-children');
    await expect(nested.getByRole('link', { name: CHILD, exact: true })).toBeVisible();
    // ...and only there: the space's top level lists the parent, not the child.
    await page.goto(`/s/${A.key}`);
    const topList = page.getByRole('main').locator('.list');
    await expect(topList.getByRole('link', { name: PARENT, exact: true })).toBeVisible();
    await expect(topList.getByRole('link', { name: CHILD, exact: true })).toHaveCount(0);

    // Reopening the sub-page by its URL: breadcrumb shows the parent.
    await page.goto(childUrl);
    await expect(page.getByLabel('Page title')).toHaveValue(CHILD);
    await expect(page.locator('.crumb').getByRole('link', { name: PARENT, exact: true })).toBeVisible();
    await expect(nested.getByRole('link', { name: CHILD, exact: true })).toBeVisible();

    // The parent lists it under "Sub-pages".
    await page.goto(parentUrl);
    await expect(page.locator('.subpages').getByRole('link', { name: CHILD, exact: true })).toBeVisible();
  });
});
