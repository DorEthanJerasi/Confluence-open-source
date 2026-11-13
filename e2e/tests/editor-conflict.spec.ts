// Lean suite, row 13 (docs/done-checks/10-e2e-speed.md): two tabs on one
// page, the second save gets the 409 note and keeps its text until Reload
// (docs/done-checks/02-editor.md, E2E list; also apps/server/test/pages.test.ts).
import { test, expect, type Page } from '../fixtures';
import { createPage, createSpace, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
let pageUrl = '';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

test.describe.serial('editor save conflict', () => {
  test.beforeAll(resetDatabase);

  test('two tabs: second save gets 409 note and keeps text', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    // The page is made through the API with the text editor.spec.ts types
    // and reloads on screen; this test is about what comes after.
    await signUp(a, admin);
    await createSpace(a, { name: 'Ocean Notes', key: 'ocean-notes' });
    pageUrl = (await createPage(a, 'ocean-notes', { title: 'Tides', text: 'Hello calm world' })).path;
    const b = await ctx.newPage();
    await a.goto(pageUrl);
    await b.goto(pageUrl);
    await body(a).click();
    await a.keyboard.press('Control+End');
    await a.keyboard.insertText(' from A');
    await expect(a.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
    await body(b).click();
    await b.keyboard.press('Control+End');
    await b.keyboard.insertText(' from B');
    await expect(b.getByRole('alert')).toContainText('changed somewhere else', { timeout: 10_000 });
    await expect(b.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(body(b)).toContainText('from B');
    await b.getByRole('button', { name: 'Reload' }).click();
    await expect(body(b)).toContainText('from A');
    await ctx.close();
  });
});
