// AI browser tests (docs/done-checks/04-ai.md), part 2 (see ai.spec.ts),
// against the stub provider: asking about a word written on a page shows the
// answer, and both the [1] link and the Sources entry open that page.
import { test, expect, type Page } from '../fixtures';
import { pickBlankPage } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const WORD = 'glimmerfinch';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const askField = (page: Page) => page.getByLabel('Your question');
const answer = (page: Page) => page.getByRole('region', { name: 'Answer' });

async function newPage(page: Page, title: string, text: string) {
  await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
  await pickBlankPage(page);
  await expect(page).toHaveURL(/\/p\/.+/);
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('Page title').blur();
  await body(page).click();
  await page.keyboard.type(text);
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
  return page.url();
}

async function ask(page: Page, q: string) {
  await page.getByRole('link', { name: 'Ask' }).click();
  await expect(page).toHaveURL('/ask');
  await askField(page).fill(q);
  await page.keyboard.press('Enter');
}

test.describe.serial('ask your docs', () => {
  test.beforeAll(resetDatabase);

  test('asking about a word on a page shows the answer, and both the [1] link and the Sources entry open that page', async ({
    page,
  }) => {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password', { exact: false }).fill(admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Open Room');
    await page.getByLabel('Default role').selectOption('editor');
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL('/s/open-room');

    const pageUrl = await newPage(page, 'Garden notes', `A ${WORD} visited the feeder at dawn.`);

    await ask(page, `What is a ${WORD}?`);
    await expect(answer(page)).toBeVisible({ timeout: 10_000 });

    const cite = answer(page).locator('.ask-cite').first();
    await expect(cite).toBeVisible();
    const sourceEntry = page.getByRole('link').filter({ hasText: 'Garden notes' }).first();
    await expect(sourceEntry).toBeVisible();

    // Screenshots are taken here, on /ask with the answer showing, before
    // either link is clicked and navigates away. Reduced motion is emulated
    // so the theme switch is settled, not mid-fade, by the time we shoot.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/ai-ask-dark.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: 'test-results/ai-ask-light.png', fullPage: true });
    await page.emulateMedia({ reducedMotion: null });

    await cite.click();
    await expect(page).toHaveURL(pageUrl);
    await expect(body(page)).toContainText(WORD);

    // Going back remounts the Ask screen fresh (client-side routing swaps the
    // outlet), so the answer is asked again before trying the Sources link.
    await page.goto('/ask');
    await askField(page).fill(`What is a ${WORD}?`);
    await page.keyboard.press('Enter');
    await expect(answer(page)).toBeVisible({ timeout: 10_000 });
    await page.locator('.ask-sources').getByRole('link', { name: /Garden notes/ }).click();
    await expect(page).toHaveURL(pageUrl);
  });
});
