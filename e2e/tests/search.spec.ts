// Lean suite, rows 17-19 (docs/done-checks/10-e2e-speed.md): search on
// screen (docs/done-checks/03-search-history.md, 3a). A word typed into a
// page is found through Ctrl+K, highlighted with <mark>, and opens the page;
// page text that looks like HTML stays text; reload on /search?q=… keeps the
// results, Back returns to the earlier query, light and dark. That a
// non-member of a restricted space gets no results is proven by
// apps/server/test/search.test.ts.
import { test, expect, type Page } from '../fixtures';
import { createPage, createSpace, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const WORD = 'zephyrquill';
const TAG = '<img src=x onerror=alert(1)>';
const NASTY = `${TAG} marmoset`;

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const results = (page: Page) => page.getByRole('list', { name: 'Search results' });

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

  test('a typed word is found with Ctrl+K, highlighted and opens its page; HTML-looking text stays text; reload and Back keep the results, light and dark', async ({
    page,
  }) => {
    // Sign-up, the restricted space and both pages come through the API
    // (wiki.spec.ts clicks through those forms); the word goes into the
    // editor in one step (keyboard.insertText; key-by-key typing is
    // editor.spec.ts) and the editor saves it, as it would for a person.
    await signUp(page, admin);
    await createSpace(page, { name: 'Quiet Room', key: 'quiet-room', visibility: 'restricted' });
    const oddUrl = (await createPage(page, 'quiet-room', { title: `Odd ${TAG}`, text: NASTY })).path;
    const pageUrl = (await createPage(page, 'quiet-room', { title: 'Night shift' })).path;
    await page.goto(pageUrl);
    await body(page).click();
    await page.keyboard.insertText(`The ${WORD} sleeps here`);
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });

    // Row 17. The focus is still in the editor: Ctrl+K must reach the search field.
    await search(page, WORD);
    const hit = results(page).getByRole('link', { name: /Night shift/ });
    await expect(hit).toBeVisible();
    await expect(hit).toContainText('Quiet Room');
    await expect(hit.locator('mark')).toHaveText(WORD);
    await hit.click();
    await expect(page).toHaveURL(pageUrl);
    await expect(body(page)).toContainText(WORD);

    // Row 18: the title holds the tag as plain text; the snippet is text with one <mark>.
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    await search(page, 'marmoset');
    const odd = results(page).getByRole('link', { name: /^Odd / });
    await expect(odd.locator('.result-title')).toHaveText(`Odd ${TAG}`);
    await expect(odd.locator('.result-snippet')).toContainText('onerror=alert(1)>');
    await expect(odd.locator('mark')).toHaveText('marmoset');
    await expect(results(page).locator('img')).toHaveCount(0);
    await expect(page.locator('main img')).toHaveCount(0);
    // Opening it shows the same text literally on the page.
    await odd.click();
    await expect(page).toHaveURL(oddUrl);
    await expect(body(page)).toContainText(NASTY);
    await expect(body(page).locator('img')).toHaveCount(0);
    expect(dialogs).toBe(0);

    // Row 19: /search?q=… survives a reload.
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
});
