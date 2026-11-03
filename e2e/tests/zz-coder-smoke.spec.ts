// Scratch check by the coder; not committed.
import { test, expect, type Page } from '@playwright/test';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'battery horse correct' };
let pageUrl = '';

async function logIn(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

async function slash(page: Page, query: string, pick: string) {
  await page.keyboard.type('/' + query);
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: new RegExp('^' + pick) }).click();
}

test.describe.serial('editor smoke', () => {
  test('setup + type, save, reload', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Name').fill(admin.name);
    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password', { exact: false }).fill(admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Ocean Notes');
    await page.getByRole('button', { name: 'Create space' }).click();
    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
    await expect(page).toHaveURL(/\/p\/.+/);
    pageUrl = page.url();
    await page.getByLabel('Page title').fill('Tides');
    await page.getByLabel('Page title').blur();

    await body(page).click();
    await page.keyboard.type('Hello calm world');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await page.reload();
    await expect(body(page)).toContainText('Hello calm world');
  });

  test('slash filter, every block, code highlight, table, ids', async ({ page }) => {
    await logIn(page, admin);
    await page.goto(pageUrl);
    await body(page).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await page.keyboard.type('/head');
    const menu = page.getByRole('listbox', { name: 'Insert block' });
    await expect(menu.getByRole('option')).toHaveCount(3);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second heading');
    await expect(body(page).locator('h2')).toHaveText('Second heading');
    await page.keyboard.press('Enter');

    // Esc closes the menu.
    await page.keyboard.type('/quo');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

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
      await page.keyboard.type(pick + ' text');
      await expect(body(page).locator(sel).last()).toContainText(pick + ' text');
      // leave the block: Enter twice exits lists/quotes/callouts
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      if (['h1', 'h3'].includes(sel)) await page.keyboard.press('Backspace');
    }
    await slash(page, 'divid', 'Divider');
    await expect(body(page).locator('hr')).toHaveCount(1);

    await slash(page, 'code', 'Code block');
    await page.keyboard.type('const x = 1');
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
    await expect(table.locator('tr').first().locator('th')).toHaveCount(3);
    await page.keyboard.type('cell');

    // markdown shortcuts
    await body(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## md heading');
    await expect(body(page).locator('h2', { hasText: 'md heading' })).toHaveCount(1);

    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await page.screenshot({ path: 'test-results/coder-light.png', fullPage: true });
    await page.reload();
    await expect(body(page).locator('pre code span[class^="hljs"]').first()).toBeVisible();
    await expect(body(page).locator('table')).toContainText('cell');

    const id = pageUrl.split('/p/')[1];
    const res = await page.request.get(`/api/pages/${id}`);
    const { page: p } = await res.json();
    const ids = p.doc.content.map((b: { attrs?: { id?: string } }) => b.attrs?.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(p.doc)).not.toContain('data:');
    const types = new Set(p.doc.content.map((b: { type: string }) => b.type));
    for (const t of ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'callout', 'horizontalRule', 'codeBlock', 'table'])
      expect(types, t).toContain(t);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.screenshot({ path: 'test-results/coder-dark.png', fullPage: true });
  });

  test('viewer sees content, no editable surface', async ({ page }) => {
    await logIn(page, admin);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Add a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await dialog.getByLabel('Name').fill(viewer.name);
    await dialog.getByLabel('Email').fill(viewer.email);
    await dialog.getByLabel('Starting password').fill(viewer.password);
    await dialog.getByLabel('Role').selectOption('viewer');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(viewer.email)).toBeVisible();
    await page.context().clearCookies();
    await logIn(page, viewer);
    await page.goto(pageUrl);
    await expect(body(page)).toContainText('Hello calm world');
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('textbox', { name: 'Page content' })).toHaveCount(0);
  });

  test('two tabs: second save gets 409 note and keeps text', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    await logIn(a, admin);
    const b = await ctx.newPage();
    await a.goto(pageUrl);
    await b.goto(pageUrl);
    await body(a).click();
    await a.keyboard.press('Control+End');
    await a.keyboard.type(' from A');
    await expect(a.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await body(b).click();
    await b.keyboard.press('Control+End');
    await b.keyboard.type(' from B');
    await expect(b.getByRole('alert')).toContainText('changed somewhere else', { timeout: 10_000 });
    await expect(b.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(body(b)).toContainText('from B');
    await b.getByRole('button', { name: 'Reload' }).click();
    await expect(body(b)).toContainText('from A');
    await ctx.close();
  });
});
