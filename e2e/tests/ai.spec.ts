// Lean suite, rows 26-27 (docs/done-checks/10-e2e-speed.md): AI on screen
// (docs/done-checks/04-ai.md). The server runs against the deterministic
// stub (AI_PROVIDER=stub, no API key, global-setup.ts), so this never
// touches the network. Summarise shows the stub's summary (the page's first
// sentences) in the card; asking about a word on a page shows the answer,
// and both the [1] link and the Sources entry open that page. That a
// non-member gets "couldn't find" with no sources is proven by
// apps/server/test/ai-ask.test.ts; AI switched off is ai-off.spec.ts.
import { test, expect, type Page } from '../fixtures';
import { createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const WORD = 'glimmerfinch';
let gardenUrl = '';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const askField = (page: Page) => page.getByLabel('Your question');
const answer = (page: Page) => page.getByRole('region', { name: 'Answer' });

test.describe.serial('ai', () => {
  test.beforeAll(resetDatabase);

  test('writing a page and pressing Summarise shows the first sentence in the card', async ({ page }) => {
    // Sign-up, the space and both pages, text and all, come through the API
    // (wiki.spec.ts clicks through those forms; typing and autosave are
    // editor.spec.ts); this test is about Summarise (item #145).
    await signUp(page, admin);
    await createSpace(page, { name: 'Open Room', key: 'open-room', defaultRole: 'editor' });
    gardenUrl = (await createPage(page, 'open-room', { title: 'Garden notes', text: `A ${WORD} visited the feeder at dawn.` })).path;
    const { path } = await createPage(page, 'open-room', {
      title: 'Quiet page',
      text: 'The lake was still at dawn. A heron stood in the shallows.',
    });
    await page.goto(path);
    await expect(body(page)).toContainText('The lake was still at dawn.');

    const summariseButton = page.getByRole('button', { name: 'Summarise' });
    await expect(summariseButton).toBeVisible();
    await summariseButton.click();

    const card = page.getByRole('region', { name: 'Page summary' });
    await expect(card).toBeVisible();
    await expect(card.locator('.summary-text')).toContainText('The lake was still at dawn.', { timeout: 10_000 });

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/ai-summary-dark.png', fullPage: true });
  });

  test('asking about a word on a page shows the answer, and both the [1] link and the Sources entry open that page', async ({
    page,
  }) => {
    await logIn(page, admin);
    await page.getByRole('link', { name: 'Ask', exact: true }).click();
    await expect(page).toHaveURL('/ask');
    await askField(page).fill(`What is a ${WORD}?`);
    await page.keyboard.press('Enter');
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
    await expect(page).toHaveURL(gardenUrl);
    await expect(body(page)).toContainText(WORD);

    // Going back remounts the Ask screen fresh (client-side routing swaps the
    // outlet), so the answer is asked again before trying the Sources link.
    await page.goto('/ask');
    await askField(page).fill(`What is a ${WORD}?`);
    await page.keyboard.press('Enter');
    await expect(answer(page)).toBeVisible({ timeout: 10_000 });
    await page.locator('.ask-sources').getByRole('link', { name: /Garden notes/ }).click();
    await expect(page).toHaveURL(gardenUrl);
  });
});
