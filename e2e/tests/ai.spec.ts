// AI browser tests (docs/done-checks/04-ai.md): the server runs against the
// deterministic stub (AI_PROVIDER=stub, no API key — global-setup.ts), so
// this never touches the network.
//
// 4b: writing a page and pressing Summarise shows the stub's summary (the
// page's first sentences) in the card, and a dark-mode screenshot is saved
// for the designer.
//
// 4d: asking about a word written on a page shows the answer, and both the
// [1] link and the Sources entry open that page; a viewer who is not a
// member of a restricted space asks about a word only in that space and
// gets the fixed "couldn't find" answer with no sources; with AI off (via
// page.route on /api/ai/status), there is no Summarise button and no Ask
// entry in the top bar, and /ask shows the not-set-up note.
import { test, expect, type Page } from '@playwright/test';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const outsider = { name: 'Otto Outsider', email: 'otto@stillwater.test', password: 'battery horse correct' };
const WORD = 'glimmerfinch';

async function logIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const askField = (page: Page) => page.getByLabel('Your question');
const answer = (page: Page) => page.getByRole('region', { name: 'Answer' });

async function newPage(page: Page, title: string, text: string) {
  await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
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

test.describe.serial('ai summarise', () => {
  test.beforeAll(resetDatabase);

  test('writing a page and pressing Summarise shows the first sentence in the card', async ({ page }) => {
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

    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
    await expect(page).toHaveURL(/\/p\/.+/);
    await page.getByLabel('Page title').fill('Quiet page');
    await page.getByLabel('Page title').blur();

    const pageBody = page.locator('.page-editor .ProseMirror');
    await pageBody.click();
    await page.keyboard.type('The lake was still at dawn. A heron stood in the shallows.');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });

    const summariseButton = page.getByRole('button', { name: 'Summarise' });
    await expect(summariseButton).toBeVisible();
    await summariseButton.click();

    const card = page.getByRole('region', { name: 'Page summary' });
    await expect(card).toBeVisible();
    const summaryText = card.locator('.summary-text');
    await expect(summaryText).toContainText('The lake was still at dawn.', { timeout: 10_000 });

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/ai-summary-dark.png', fullPage: true });
  });
});

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

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/ai-ask-dark.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: 'test-results/ai-ask-light.png', fullPage: true });
  });

  test('a viewer who is not a member of a restricted space gets the "couldn\'t find" answer, with no sources', async ({
    page,
  }) => {
    await logIn(page, admin);

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Quiet Room');
    await page.getByLabel('Who can see it').selectOption('restricted');
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL('/s/quiet-room');
    await newPage(page, 'Private notes', 'The hushwarbler nests only here.');

    await page.goto('/admin/users');
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await page.getByRole('button', { name: 'Add a person' }).click();
    await dialog.getByLabel('Name').fill(outsider.name);
    await dialog.getByLabel('Email').fill(outsider.email);
    await dialog.getByLabel('Starting password').fill(outsider.password);
    await dialog.getByLabel('Role').selectOption('viewer');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(outsider.email)).toBeVisible();

    await page.context().clearCookies();
    await logIn(page, outsider);
    await ask(page, 'What nests in the hushwarbler room?');

    await expect(page.getByText("I couldn't find anything about that in the pages you can see.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.ask-sources')).toHaveCount(0);
    await expect(page.locator('.ask-cite')).toHaveCount(0);
  });

  test('with AI off, Summarise and the Ask entry are both hidden, and /ask shows the not-set-up note', async ({ page }) => {
    await page.route('**/api/ai/status', (r) => r.fulfill({ json: { enabled: false } }));

    await logIn(page, admin);
    await page.goto('/s/open-room');
    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('link', { name: 'Garden notes' }).click();
    await expect(page.getByRole('button', { name: 'Summarise' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask' })).toHaveCount(0);

    await page.goto('/ask');
    await expect(page.getByText('AI is not set up on this wiki')).toBeVisible();
    await expect(askField(page)).toHaveCount(0);
  });
});
