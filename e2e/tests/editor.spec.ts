// Stage 2a editor checks (docs/done-checks/02-editor.md, E2E list), part 1:
// type, save, reload; a viewer gets no editable surface; the slash menu has
// no animation with reduced motion. The slash-command walk through every
// block is editor-slash.spec.ts and the two-tab conflict is
// editor-conflict.spec.ts; each sets itself up through the API helpers.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const viewer = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'battery horse correct' };
let pageUrl = '';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

test.describe.serial('editor', () => {
  // Spec files that land on the same worker share its server; start this file from an empty database.
  test.beforeAll(resetDatabase);

  test('setup + type, save, reload', async ({ page }) => {
    // Sign-up, the space and the empty page come through the API (wiki.spec.ts
    // clicks through those forms and the title field); this test is about typing.
    await signUp(page, admin);
    await createSpace(page, { name: 'Ocean Notes', key: 'ocean-notes' });
    pageUrl = (await createPage(page, 'ocean-notes', { title: 'Tides' })).path;
    await page.goto(pageUrl);

    await body(page).click();
    await page.keyboard.type('Hello calm world');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    await page.reload();
    await expect(body(page)).toContainText('Hello calm world');
  });

  test('viewer sees content, no editable surface', async ({ page }) => {
    await logIn(page, admin, null);
    await addPerson(page, viewer, 'viewer');
    await page.context().clearCookies();
    await logIn(page, viewer, pageUrl);
    await expect(body(page)).toContainText('Hello calm world');
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('textbox', { name: 'Page content' })).toHaveCount(0);
  });

  test('slash menu has no animation with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await logIn(page, admin, pageUrl);
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const menu = page.getByRole('listbox', { name: 'Insert block' });
    await expect(menu).toBeVisible();
    const duration = await menu.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });
});
