// Stage 3a search on screen (docs/done-checks/03-search-history.md, 3a E2E):
// a word typed into a page is found through Ctrl+K and highlighted with
// <mark>; a non-member of the restricted space gets "No results"; page text
// that looks like HTML stays text; reload on /search?q=… keeps the results.
import { test, expect, type Page } from '@playwright/test';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const outsider = { name: 'Otto Outsider', email: 'otto@stillwater.test', password: 'battery horse correct' };
const WORD = 'zephyrquill';
const TAG = '<img src=x onerror=alert(1)>';
const NASTY = `${TAG} marmoset`;
let pageUrl = '';

async function logIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const results = (page: Page) => page.getByRole('list', { name: 'Search results' });

async function newPage(page: Page, title: string, text: string) {
  await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
  await expect(page).toHaveURL(/\/p\/.+/);
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('Page title').blur();
  await body(page).click();
  await page.keyboard.type(text);
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
}

/** Ctrl+K from wherever the focus is, type the query, Enter. */
async function search(page: Page, q: string) {
  await page.keyboard.press('Control+k');
  const field = page.getByRole('searchbox', { name: 'Search pages' });
  await expect(field).toBeFocused();
  await field.fill(q);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/search?q=${encodeURIComponent(q)}`);
}

test.describe.serial('search', () => {
  test.beforeAll(resetDatabase);

  test('a word typed into a page is found with Ctrl+K, highlighted, and opens the page', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password', { exact: false }).fill(admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Quiet Room');
    await page.getByLabel('Who can see it').selectOption('restricted');
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL('/s/quiet-room');

    await newPage(page, 'Night shift', `The ${WORD} sleeps here`);
    pageUrl = page.url();

    // The focus is still in the editor: Ctrl+K must reach the search field.
    await search(page, WORD);
    const hit = results(page).getByRole('link', { name: /Night shift/ });
    await expect(hit).toBeVisible();
    await expect(hit).toContainText('Quiet Room');
    await expect(hit.locator('mark')).toHaveText(WORD);

    await hit.click();
    await expect(page).toHaveURL(pageUrl);
    await expect(body(page)).toContainText(WORD);
  });

  test('page text that looks like HTML is shown as text, never as an element', async ({ page }) => {
    await logIn(page, admin);
    await page.goto('/s/quiet-room');
    await newPage(page, `Odd ${TAG}`, NASTY);
    const oddUrl = page.url();

    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    await search(page, 'marmoset');
    const hit = results(page).getByRole('link', { name: /^Odd / });
    // The title holds the tag as plain text; the snippet is text with one <mark>.
    await expect(hit.locator('.result-title')).toHaveText(`Odd ${TAG}`);
    await expect(hit.locator('.result-snippet')).toContainText('onerror=alert(1)>');
    await expect(hit.locator('mark')).toHaveText('marmoset');
    await expect(results(page).locator('img')).toHaveCount(0);
    await expect(page.locator('main img')).toHaveCount(0);

    // Opening it shows the same text literally on the page.
    await hit.click();
    await expect(page).toHaveURL(oddUrl);
    await expect(body(page)).toContainText(NASTY);
    await expect(body(page).locator('img')).toHaveCount(0);
    expect(dialogs).toBe(0);
  });

  test('reload on /search?q=… shows the same results, in light and dark', async ({ page }) => {
    await logIn(page, admin);
    await page.goto(`/search?q=${WORD}`);
    await expect(results(page).getByRole('link')).toHaveCount(1);
    await expect(page.getByRole('searchbox', { name: 'Search pages' })).toHaveValue(WORD);
    await page.reload();
    await expect(results(page).getByRole('link', { name: /Night shift/ })).toBeVisible();
    await expect(results(page).locator('mark')).toHaveText(WORD);

    // Back returns to the earlier query.
    await search(page, 'marmoset');
    await expect(results(page).getByRole('link', { name: /^Odd / })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`/search?q=${WORD}`);
    await expect(results(page).getByRole('link', { name: /Night shift/ })).toBeVisible();

    // The list's fade is skipped when the reader asks for less motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await results(page).evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.01);

    await page.screenshot({ path: 'test-results/search-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/search-dark.png', fullPage: true });
  });

  test('someone who is not a member of the restricted space gets no results', async ({ page }) => {
    await logIn(page, admin);
    await page.goto('/admin/users');
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await page.getByRole('button', { name: 'Add a person' }).click();
    await dialog.getByLabel('Name').fill(outsider.name);
    await dialog.getByLabel('Email').fill(outsider.email);
    await dialog.getByLabel('Starting password').fill(outsider.password);
    await dialog.getByLabel('Role').selectOption('editor');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(outsider.email)).toBeVisible();

    await page.context().clearCookies();
    await logIn(page, outsider);
    await search(page, WORD);
    await expect(page.getByText('No results')).toBeVisible();
    await expect(results(page)).toHaveCount(0);
  });
});
