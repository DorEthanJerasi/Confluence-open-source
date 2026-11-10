// Lean suite, rows 1-5 (docs/done-checks/10-e2e-speed.md, "Where each
// behaviour is proven"): the real forms a new team meets first. Sign up
// (first account is admin), the "New space" dialog, "New page", the title,
// a sub-page made with the Sub-page button sitting under its parent, the
// page reopened from Home, the "Add a person" dialog, and log out / log in
// through the forms. Runs against a real server + Postgres (../global-setup.ts).
import { test, expect, type Page } from '../fixtures';
import { pickBlankPage } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'battery horse correct' };
const spaceName = 'Ocean Notes';
const spaceKey = 'ocean-notes';
const PARENT = 'Tide tables';
const CHILD = 'Spring tides';

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Pages in this space' });

async function setTitle(page: Page, title: string) {
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('Page title').blur();
  await expect(page.getByLabel('Page title')).toHaveValue(title);
}

async function logInWithForm(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

test.describe.serial('wiki basics', () => {
  // Spec files that land on the same worker share its server; start this file from an empty database.
  test.beforeAll(resetDatabase);

  test('the first sign-up becomes admin, makes a space, a page and a sub-page, and both reopen', async ({ page }) => {
    // Row 1: sign up through the form, then the "New space" dialog and "New page".
    await page.goto('/signup');
    await page.getByLabel('Name').fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password', { exact: false }).fill(admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill(spaceName);
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL(`/s/${spaceKey}`);
    await expect(page.getByRole('heading', { name: spaceName })).toBeVisible();

    await sidebar(page).getByRole('button', { name: 'New page' }).click();
    await pickBlankPage(page);
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    await setTitle(page, PARENT);
    const parentUrl = page.url();

    // Row 4: a sub-page made with the Sub-page button sits under its parent in the tree.
    await page.getByRole('button', { name: 'Sub-page', exact: true }).click();
    await pickBlankPage(page);
    await expect(page).not.toHaveURL(parentUrl);
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    await setTitle(page, CHILD);
    const childUrl = page.url();
    const parentRow = sidebar(page).locator('li', { has: page.getByRole('link', { name: PARENT, exact: true }) }).first();
    const nested = parentRow.locator('.tree-children');
    await expect(nested.getByRole('link', { name: CHILD, exact: true })).toBeVisible();

    // Row 2: reopening the page from Home shows the saved title. The space's
    // card (Home's "Recently viewed" also names the space).
    await page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click();
    await page.getByRole('region', { name: 'Spaces' }).getByRole('link', { name: spaceName }).click();
    await expect(page).toHaveURL(`/s/${spaceKey}`);
    // The space's top level lists the parent, not the child.
    const topList = page.getByRole('main').locator('.list');
    await expect(topList.getByRole('link', { name: CHILD, exact: true })).toHaveCount(0);
    await topList.getByRole('link', { name: PARENT, exact: true }).click();
    await expect(page).toHaveURL(parentUrl);
    await expect(page.getByLabel('Page title')).toHaveValue(PARENT);
    // The parent lists it under "Sub-pages".
    await expect(page.locator('.subpages').getByRole('link', { name: CHILD, exact: true })).toBeVisible();

    // Row 4: reopening the sub-page by its URL; the breadcrumb shows the parent.
    await page.goto(childUrl);
    await expect(page.getByLabel('Page title')).toHaveValue(CHILD);
    await expect(page.locator('.crumb').getByRole('link', { name: PARENT, exact: true })).toBeVisible();
    await expect(nested.getByRole('link', { name: CHILD, exact: true })).toBeVisible();
  });

  test('an admin adds a viewer in the "Add a person" dialog; logging out ends the session and logging in brings it back', async ({
    page,
  }) => {
    // Row 3: the "Add a person" dialog.
    await logInWithForm(page, admin);
    await expect(page.locator('.who-name')).toHaveText(admin.name);
    await page.goto('/admin/users');
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await page.getByRole('button', { name: 'Add a person' }).click();
    await dialog.getByLabel('Name').fill(viewer.name);
    await dialog.getByLabel('Email').fill(viewer.email);
    await dialog.getByLabel('Starting password').fill(viewer.password);
    await dialog.getByLabel('Role').selectOption('viewer');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(viewer.email)).toBeVisible();

    // Row 5: log out; the session is really gone (the app sends you back, the API refuses).
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL('/login');
    await page.goto(`/s/${spaceKey}`);
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/spaces')).status()).toBe(401);

    // The new viewer logs in through the form and lands in the space.
    await logInWithForm(page, viewer);
    await expect(page.locator('.who-name')).toHaveText(viewer.name);
    await page.goto(`/s/${spaceKey}`);
    await expect(page.getByRole('heading', { name: spaceName })).toBeVisible();
  });
});
