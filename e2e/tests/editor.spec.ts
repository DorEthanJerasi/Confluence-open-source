// Lean suite, rows 10-12 (docs/done-checks/10-e2e-speed.md): the editor on
// screen. Type, autosave, reload, the text is still there, and with reduced
// motion the slash menu has no animation; then the slash menu filters and
// inserts every block, code is highlighted, the table toolbar works, and
// markdown shortcuts work. "Every block type is stored, each with a unique
// id" is proven by apps/server/test/pages.test.ts. The two-tab conflict is
// editor-conflict.spec.ts; what a viewer sees is viewer.spec.ts.
// The first test types key by key. After that, plain text inside a block
// goes in with keyboard.insertText (one step, the way a paste or an input
// method puts it in, still through the editor and its autosave): key-by-key
// typing cost about 1 s per line on this busy box (item #145). The slash
// queries and the "## " shortcut are still typed key by key, since keys are
// what they react to.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const menu = (page: Page) => page.getByRole('listbox', { name: 'Insert block' });

async function slash(page: Page, query: string, pick: string) {
  await page.keyboard.type('/' + query);
  await expect(menu(page)).toBeVisible();
  await menu(page).getByRole('option', { name: new RegExp('^' + pick) }).click();
}

test.describe.serial('editor', () => {
  // Spec files that land on the same worker share its server; start this file from an empty database.
  test.beforeAll(resetDatabase);

  test('type, save, reload; the slash menu has no animation with reduced motion', async ({ page }) => {
    // Sign-up, the space and the empty page come through the API (wiki.spec.ts
    // clicks through those forms and the title field); this test is about typing.
    await signUp(page, admin);
    await createSpace(page, { name: 'Ocean Notes', key: 'ocean-notes' });
    const { path } = await createPage(page, 'ocean-notes', { title: 'Tides' });
    await page.goto(path);

    await body(page).click();
    await page.keyboard.type('Hello calm world');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
    await page.reload();
    await expect(body(page)).toContainText('Hello calm world');

    // Row 12: same page, the reader asks for less motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(menu(page)).toBeVisible();
    const duration = await menu(page).evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });

  test('slash filter, every block, code highlight, table toolbar, markdown shortcuts', async ({ page }) => {
    test.setTimeout(90_000);
    await logIn(page, admin, null);
    const { path } = await createPage(page, 'ocean-notes', { title: 'Blocks', text: 'Hello calm world' });
    await page.goto(path);
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await page.keyboard.type('/head');
    await expect(menu(page).getByRole('option')).toHaveCount(3);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Second heading');
    await expect(body(page).locator('h2')).toHaveText('Second heading');
    await page.keyboard.press('Enter');

    // Esc closes the menu.
    await page.keyboard.type('/quo');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');

    for (const [q, pick, sel] of [
      ['head', 'Heading 1', 'h1'],
      ['head', 'Heading 3', 'h3'],
      ['bul', 'Bullet list', 'ul:not([data-type])'],
      ['numb', 'Numbered list', 'ol'],
      ['task', 'Task list', 'ul[data-type="taskList"]'],
      ['quo', 'Quote', 'blockquote'],
      ['call', 'Callout', 'div.callout'],
    ] as const) {
      await slash(page, q, pick);
      await page.keyboard.insertText(pick + ' text');
      await expect(body(page).locator(sel).last()).toContainText(pick + ' text');
      // leave the block: Enter twice exits lists/quotes/callouts
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      if (['h1', 'h3'].includes(sel)) await page.keyboard.press('Backspace');
    }
    await slash(page, 'divid', 'Divider');
    await expect(body(page).locator('hr')).toHaveCount(1);

    await slash(page, 'code', 'Code block');
    await page.keyboard.insertText('const x = 1');
    await expect(body(page).locator('pre')).toContainText('const x = 1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await slash(page, 'tab', 'Table');
    const table = body(page).locator('table');
    await expect(table.locator('tr')).toHaveCount(3);
    await expect(table.locator('tr').first().locator('th')).toHaveCount(3);
    const tmenu = page.getByRole('toolbar', { name: 'Table' });
    await tmenu.getByRole('button', { name: 'Add row' }).click();
    await expect(table.locator('tr')).toHaveCount(4);
    await tmenu.getByRole('button', { name: 'Add column' }).click();
    await expect(table.locator('tr').first().locator('th')).toHaveCount(4);
    await tmenu.getByRole('button', { name: 'Remove row' }).click();
    await expect(table.locator('tr')).toHaveCount(3);
    await tmenu.getByRole('button', { name: 'Remove column' }).click();
    // The caret sat in the header row, so "Remove row" took that row; count cells of either kind.
    await expect(table.locator('tr').first().locator('th, td')).toHaveCount(3);
    await page.keyboard.insertText('cell');

    // markdown shortcuts
    await body(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## ');
    await page.keyboard.insertText('md heading');
    await expect(body(page).locator('h2', { hasText: 'md heading' })).toHaveCount(1);

    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
    await page.screenshot({ path: 'test-results/editor-light.png', fullPage: true });
    await page.reload();
    await expect(body(page).locator('pre code span[class^="hljs"]').first()).toBeVisible();
    await expect(body(page).locator('table')).toContainText('cell');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/editor-dark.png', fullPage: true });
  });

  // Locks (docs/done-checks/17-locks.md, 17b). The server tests prove every
  // refusal; this proves what only a browser shows. Ada locks a page, Eve (a
  // second editor) sees the quiet note and cannot type, Ada unlocks, Eve types
  // and it saves (the "Saved" status; reload-and-text is test 1). Both people and the page come through the API.
  test('an editor locks a page; a second editor sees it read-only with the note; unlocking restores editing', async ({ page }) => {
    await logIn(page, admin, null);
    const eve = { name: 'Eve Editor', email: 'eve@stillwater.test', password: 'battery horse correct' };
    await addPerson(page, eve, 'editor');
    await createSpace(page, { name: 'Lock Room', key: 'lock-room', defaultRole: 'editor' });
    const { path } = await createPage(page, 'lock-room', { title: 'Budget', text: 'Q4 numbers' });
    await page.goto(path);
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByText('Locked by Ada Admin')).toBeVisible();

    await page.context().clearCookies();
    await logIn(page, eve, path);
    await expect(page.getByText('Locked by Ada Admin')).toBeVisible();
    await expect(body(page)).toContainText('Q4 numbers');
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');

    await page.context().clearCookies();
    await logIn(page, admin, path);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByText('Locked by Ada Admin')).toHaveCount(0);

    await page.context().clearCookies();
    await logIn(page, eve, path);
    await expect(body(page)).toHaveAttribute('contenteditable', 'true');
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' and Q1 plan');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 10_000 });
  });
});
