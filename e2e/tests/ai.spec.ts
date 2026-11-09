// AI browser tests (docs/done-checks/04-ai.md), part 1: the server runs
// against the deterministic stub (AI_PROVIDER=stub, no API key —
// global-setup.ts), so this never touches the network.
//
// 4b: writing a page and pressing Summarise shows the stub's summary (the
// page's first sentences) in the card, and a dark-mode screenshot is saved
// for the designer.
//
// Ask-your-docs is ai-ask.spec.ts (answer and source links) and
// ai-ask-access.spec.ts (restricted space, AI off); each sets itself up on
// its own so the files can run on different workers.
import { test, expect } from '../fixtures';
import { pickBlankPage } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };

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
    await pickBlankPage(page);
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
