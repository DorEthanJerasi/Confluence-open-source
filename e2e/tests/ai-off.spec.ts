// Lean suite, row 29 (docs/done-checks/10-e2e-speed.md): with AI off (via
// page.route on /api/ai/status), there is no Summarise button and no Ask
// entry in the top bar, and /ask shows the not-set-up note.
import { test, expect } from '../fixtures';
import { createPage, createSpace, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };

test.describe.serial('ai switched off', () => {
  test.beforeAll(resetDatabase);

  test('with AI off, Summarise and the Ask entry are both hidden, and /ask shows the not-set-up note', async ({ page }) => {
    await page.route('**/api/ai/status', (r) => r.fulfill({ json: { enabled: false } }));
    await signUp(page, admin);
    await createSpace(page, { name: 'Open Room', key: 'open-room', defaultRole: 'editor' });
    const { path } = await createPage(page, 'open-room', { title: 'Garden notes', text: 'A glimmerfinch visited the feeder at dawn.' });

    await page.goto(path);
    await expect(page.getByLabel('Page title')).toHaveValue('Garden notes');
    await expect(page.getByRole('button', { name: 'Summarise' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask' })).toHaveCount(0);

    await page.goto('/ask');
    await expect(page.getByText('AI is not set up on this wiki')).toBeVisible();
    await expect(page.getByLabel('Your question')).toHaveCount(0);
  });
});
