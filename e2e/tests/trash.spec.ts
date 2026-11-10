// Trash on screen (docs/done-checks/11-trash.md, 11b). An editor deletes a
// page with a sub-page from the tree, finds it in the Trash view and restores
// it to the same address (dark mode once). A space admin empties the trash
// after a confirm; the page link then shows "Nothing here". A viewer sees no
// Trash link and is told they cannot see the trash. Restore, purge and who
// may do what on the server are proven by apps/server/test/trash.test.ts.
// Set-up goes through the API helpers in e2e/login.ts.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const editor = { name: 'Ed Editor', email: 'ed@stillwater.test', password: 'battery horse correct' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'horse battery correct' };

const tree = (page: Page) => page.getByRole('complementary', { name: 'Pages in this space' });
const treeLink = (page: Page, title: string) => tree(page).getByRole('link', { name: title, exact: true });
const trashItems = (page: Page) => page.getByRole('list', { name: 'Deleted pages' }).getByRole('listitem');
const pageTitle = (page: Page) => page.getByRole('textbox', { name: 'Page title' });

async function switchUser(page: Page, user: { email: string; password: string }, to: string) {
  await page.context().clearCookies();
  await logIn(page, user, to);
}

test.describe.serial('trash', () => {
  test.beforeAll(resetDatabase);

  test('an editor deletes a page with a sub-page from the tree and restores it from Trash to the same address (dark mode too)', async ({
    page,
  }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Garden', key: 'garden', defaultRole: 'editor' });
    const root = await createPage(page, 'garden', { title: 'Runbook', text: 'How we water.' });
    const child = await createPage(page, 'garden', { title: 'Deploys', text: 'Morning only.', parentId: root.id });
    await addPerson(page, editor, 'editor');
    await addPerson(page, viewer, 'viewer');

    await switchUser(page, editor, root.path);
    await expect(pageTitle(page)).toHaveValue('Runbook');

    // Delete from the tree: the confirm says it goes to the trash, with its sub-page, for 30 days.
    const row = tree(page).locator('.tree-row', { has: page.getByRole('link', { name: 'Runbook', exact: true }) });
    await row.hover();
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Move “Runbook” to the trash?' });
    await expect(confirm).toContainText('The page and its 1 sub-page move to the trash.');
    await expect(confirm).toContainText('kept there for 30 days');
    await confirm.getByRole('button', { name: 'Move to trash' }).click();
    await expect(treeLink(page, 'Runbook')).toHaveCount(0);
    await expect(page).toHaveURL('/s/garden');

    // Its link now says "Nothing here", and tells an editor where it went.
    await page.goto(child.path);
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
    await page.getByRole('link', { name: 'Open the trash' }).click();
    await expect(page).toHaveURL('/s/garden/trash');

    await expect(trashItems(page)).toHaveCount(1);
    const item = trashItems(page).first();
    await expect(item).toContainText('Runbook');
    await expect(item).toContainText('and 1 sub-page');
    await expect(item).toContainText('Deleted by Ed Editor just now');
    await expect(item).toContainText('Deleted for good in 30 days');
    // Editors restore; only space admins delete for good or empty the trash.
    await expect(item.getByRole('button', { name: /for good/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Empty trash' })).toHaveCount(0);

    // Dark mode, once (reduced motion so the theme switch is settled).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(item).toBeVisible();
    await page.screenshot({ path: 'test-results/trash-dark.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.emulateMedia({ reducedMotion: null });

    await item.getByRole('button', { name: 'Restore “Runbook”' }).click();
    const note = page.getByRole('status').filter({ hasText: 'is back in the page tree' });
    await expect(note).toContainText('“Runbook” is back in the page tree.');
    await expect(trashItems(page)).toHaveCount(0);
    await expect(page.getByText('The trash is empty')).toBeVisible();
    await expect(treeLink(page, 'Runbook')).toBeVisible();

    // Same address as before, and the sub-page is back under it.
    await note.getByRole('link', { name: 'Open it' }).click();
    await expect(page).toHaveURL(root.path);
    await expect(pageTitle(page)).toHaveValue('Runbook');
    await page.goto(child.path);
    await expect(pageTitle(page)).toHaveValue('Deploys');
    await expect(treeLink(page, 'Deploys')).toBeVisible();
  });

  test('a space admin empties the trash after a confirm; a viewer has no Trash link and cannot open it', async ({ page }) => {
    await logIn(page, admin, null);
    const gone = await createPage(page, 'garden', { title: 'Old notes', text: 'Out of date.' });
    expect((await page.request.delete(`/api/pages/${gone.id}`)).status()).toBe(200);

    await page.goto('/s/garden/trash');
    await expect(trashItems(page)).toHaveCount(1);
    await expect(trashItems(page).first().getByRole('button', { name: 'Delete “Old notes” for good' })).toBeVisible();
    await page.getByRole('button', { name: 'Empty trash' }).click();
    const confirm = page.getByRole('dialog', { name: 'Empty the trash?' });
    await expect(confirm).toContainText('This cannot be undone.');
    await confirm.getByRole('button', { name: 'Empty trash' }).click();
    await expect(page.getByText('The trash is empty')).toBeVisible();

    await page.goto(gone.path);
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
    await expect(page.getByText('This page is in the trash')).toHaveCount(0);

    await switchUser(page, viewer, '/s/garden');
    await expect(treeLink(page, 'Runbook')).toBeVisible();
    await expect(tree(page).getByRole('link', { name: 'Trash' })).toHaveCount(0);
    await page.goto('/s/garden/trash');
    await expect(page.getByRole('heading', { name: 'You cannot see this trash' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Deleted pages' })).toHaveCount(0);
  });
});
