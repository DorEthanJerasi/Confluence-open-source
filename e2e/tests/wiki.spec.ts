// First real e2e pass: sign up, create a space and a page, reopen it and
// see the content again, and prove a viewer cannot edit. Runs against a
// real server + Postgres (see ../global-setup.ts), not a mock.
import { test, expect, type Page } from '../fixtures';
import { pickBlankPage } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'battery horse correct' };
const spaceName = 'Ocean Notes';
const spaceKey = 'ocean-notes';
const pageTitle = 'Tide tables';

async function signUp(page: Page, user: { name: string; email: string; password: string }) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
}

async function logIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

test.describe.serial('wiki basics', () => {
  // Spec files that land on the same worker share its server; start this file from an empty database.
  test.beforeAll(resetDatabase);

  test('the first person to sign up becomes admin and can create a space and a page', async ({ page }) => {
    await signUp(page, admin);

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill(spaceName);
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL(`/s/${spaceKey}`);
    await expect(page.getByRole('heading', { name: spaceName })).toBeVisible();

    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
    await pickBlankPage(page);
    await expect(page).toHaveURL(/\/s\/ocean-notes\/p\/.+/);
    await page.getByLabel('Page title').fill(pageTitle);
    await page.getByLabel('Page title').blur();
    await expect(page.getByLabel('Page title')).toHaveValue(pageTitle);
  });

  test('reopening the page shows the saved title', async ({ page }) => {
    await logIn(page, admin);
    await page.getByRole('link', { name: spaceName }).click();
    await expect(page).toHaveURL(`/s/${spaceKey}`);
    await page.getByRole('main').getByRole('link', { name: pageTitle }).click();
    await expect(page).toHaveURL(/\/s\/ocean-notes\/p\/.+/);
    await expect(page.getByLabel('Page title')).toHaveValue(pageTitle);
  });

  test('an admin can add a person with the viewer role', async ({ page }) => {
    await logIn(page, admin);
    await page.goto('/admin/users');
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await page.getByRole('button', { name: 'Add a person' }).click();
    await dialog.getByLabel('Name').fill(viewer.name);
    await dialog.getByLabel('Email').fill(viewer.email);
    await dialog.getByLabel('Starting password').fill(viewer.password);
    await dialog.getByLabel('Role').selectOption('viewer');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(viewer.email)).toBeVisible();
  });

  test('a viewer can read the page but has no way to edit it', async ({ page }) => {
    await logIn(page, viewer);
    await page.goto(`/s/${spaceKey}`);
    await page.getByRole('main').getByRole('link', { name: pageTitle }).click();
    await expect(page).toHaveURL(/\/s\/ocean-notes\/p\/.+/);

    // Read-only: the title is plain text, not an editable field.
    await expect(page.getByLabel('Page title')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: pageTitle })).toBeVisible();

    // None of the editor-only controls are offered.
    await expect(page.getByRole('button', { name: 'Sub-page' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete page' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New page' })).toHaveCount(0);

    // The API itself refuses a write, not just the UI.
    const pageId = page.url().split('/p/')[1];
    const res = await page.request.put(`/api/pages/${pageId}`, {
      data: { baseVersion: 1, title: 'Hacked', doc: { type: 'doc', content: [] } },
    });
    expect(res.status()).toBe(403);
  });
});
