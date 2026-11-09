// Stage 09 favourites and recently viewed on screen
// (docs/done-checks/09-favourites-recent.md, 9b Playwright boxes). Two tests
// only, so the suite stays inside its time budget: an editor stars and
// unstars a page and sees both Home lists in order (dark mode once), and a
// viewer's lists lose a restricted space's page once they are removed from
// it. Set-up goes through the API helpers in e2e/login.ts.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };

async function switchUser(page: Page, user: { email: string; password: string }, to: string | null) {
  await page.context().clearCookies();
  await logIn(page, user, to);
}

const section = (page: Page, name: 'Favourites' | 'Recently viewed') =>
  page.getByRole('region', { name, exact: true });
const rows = (page: Page, name: 'Favourites' | 'Recently viewed') => section(page, name).getByRole('link');
const pageTitle = (page: Page) => page.getByRole('textbox', { name: 'Page title' });
/** Opens a page by its address and waits for the one "viewed" call it makes, so the next page load can't cut it off. */
async function openPage(page: Page, path: string) {
  const viewed = page.waitForResponse((r) => r.url().endsWith('/viewed') && r.request().method() === 'POST');
  await page.goto(path);
  expect((await viewed).status()).toBe(204);
}
const favouriteSaved = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith('/favourite') && ['PUT', 'DELETE'].includes(r.request().method()));

/** The in-app Home link: no page load, so this also proves Home updates without a reload. */
const goHome = (page: Page) => page.getByRole('navigation').getByRole('link', { name: 'Home', exact: true }).click();

test.describe.serial('favourites and recently viewed', () => {
  test.beforeAll(resetDatabase);

  test('an editor stars a page, sees both Home lists in order, then unstars it (dark mode too)', async ({ page }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Garden', key: 'garden', defaultRole: 'editor' });
    const a = await createPage(page, 'garden', { title: 'Watering plan', text: 'Twice a week.' });
    const b = await createPage(page, 'garden', { title: 'Seed list', text: 'Basil, mint.' });
    await addPerson(page, editorB, 'editor');

    // Home before anything: both headings are there with their calm empty line.
    await switchUser(page, editorB, '/');
    await expect(section(page, 'Favourites')).toContainText('Star a page to keep it here.');
    await expect(section(page, 'Recently viewed')).toContainText('Pages you open will show up here.');

    // Open A and star it, then open B.
    await openPage(page, a.path);
    await expect(pageTitle(page)).toHaveValue('Watering plan');
    const star = page.getByRole('button', { name: 'Add to favourites' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    const saved = favouriteSaved(page);
    await star.click();
    const unstar = page.getByRole('button', { name: 'Remove from favourites' });
    await expect(unstar).toHaveAttribute('aria-pressed', 'true');
    expect((await saved).status()).toBe(204);
    await openPage(page, b.path);
    await expect(pageTitle(page)).toHaveValue('Seed list');
    await expect(page.getByRole('button', { name: 'Add to favourites' })).toBeVisible();

    await goHome(page);
    await expect(rows(page, 'Favourites')).toHaveCount(1);
    await expect(rows(page, 'Favourites').first()).toContainText('Watering plan');
    await expect(rows(page, 'Favourites').first()).toContainText('Garden');
    // Last opened first.
    await expect(rows(page, 'Recently viewed')).toHaveText([/Seed list/, /Watering plan/]);

    // Dark mode, once. Reduced motion is emulated so the theme switch is
    // settled, not mid-fade, when the screenshot is taken.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(rows(page, 'Favourites').first()).toBeVisible();
    await expect(rows(page, 'Recently viewed')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/favourites-home-dark.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.emulateMedia({ reducedMotion: null });

    // Back to A from the list, unstar it there, and Home shows the empty line again.
    await rows(page, 'Favourites').first().click();
    await expect(pageTitle(page)).toHaveValue('Watering plan');
    await page.getByRole('button', { name: 'Remove from favourites' }).click();
    await expect(page.getByRole('button', { name: 'Add to favourites' })).toHaveAttribute('aria-pressed', 'false');
    await goHome(page);
    await expect(section(page, 'Favourites')).toContainText('Star a page to keep it here.');
    await expect(rows(page, 'Favourites')).toHaveCount(0);
    await expect(rows(page, 'Recently viewed')).toHaveText([/Watering plan/, /Seed list/]);
  });

  test('a viewer stars a page in a members-only space; once removed from it, the page leaves both lists', async ({ page }) => {
    await switchUser(page, admin, null);
    await createSpace(page, { name: 'Vault', key: 'vault', visibility: 'restricted' });
    const p = await createPage(page, 'vault', { title: 'Vault notes', text: 'Members only.' });
    await addPerson(page, viewerC, 'viewer');
    const users = (await (await page.request.get('/api/users')).json()) as { users: { id: string; email: string }[] };
    const cleoId = users.users.find((u) => u.email === viewerC.email)!.id;
    const add = await page.request.put(`/api/spaces/vault/members/${cleoId}`, { data: { role: 'viewer' } });
    expect(add.ok(), `add Cleo to vault: HTTP ${add.status()}`).toBe(true);

    await switchUser(page, viewerC, p.path);
    await expect(page.getByRole('heading', { name: 'Vault notes' })).toBeVisible();
    await page.getByRole('button', { name: 'Add to favourites' }).click();
    await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true');
    await goHome(page);
    await expect(rows(page, 'Favourites')).toHaveText([/Vault notes/]);
    await expect(rows(page, 'Recently viewed')).toHaveText([/Vault notes/]);

    // Ada removes Cleo from the space; after a reload, nothing from it is in Cleo's lists.
    await switchUser(page, admin, null);
    const removed = await page.request.delete(`/api/spaces/vault/members/${cleoId}`);
    expect(removed.ok(), `remove Cleo from vault: HTTP ${removed.status()}`).toBe(true);
    await switchUser(page, viewerC, '/');
    await expect(section(page, 'Favourites')).toContainText('Star a page to keep it here.');
    await expect(section(page, 'Recently viewed')).toContainText('Pages you open will show up here.');
    await expect(page.getByText('Vault notes')).toHaveCount(0);
  });
});
