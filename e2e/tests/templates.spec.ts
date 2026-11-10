// Lean suite, row 33 (docs/done-checks/10-e2e-speed.md): templates on screen
// (docs/done-checks/08-templates.md, 8b). A new page from a built-in
// template has its headings and Blank page still makes an empty one; a page
// saved as a template in the "Save as template" dialog is reused for a new
// page from the picker. Editing and deleting a saved template, and a viewer
// being refused, are proven by apps/server/test/templates.test.ts.
import { test, expect } from '../fixtures';
import { logIn, pickBlankPage } from '../login';
import { editorB, pageBody, pickTemplate, picker, setUpTemplateYard, sidebarNewPage, spaceKey, spaceUrl } from '../templates-page';
import { resetDatabase } from '../reset-db';

const MEETING_HEADINGS = ['Details', 'People', 'Agenda', 'Notes', 'Decisions', 'Next steps'];
let launchPlanPath = '';

test.describe.serial('templates', () => {
  test.beforeAll(resetDatabase);

  test('a new page from a built-in template has its headings, and Blank page still makes an empty one', async ({ page }) => {
    ({ path: launchPlanPath } = await setUpTemplateYard(page));
    await page.context().clearCookies();
    await logIn(page, editorB, spaceUrl);
    await pickTemplate(page, 'Meeting notes');

    await expect(picker(page).locator('.picker-preview-name')).toHaveText('Meeting notes');
    const preview = picker(page).locator('.picker-preview-body');
    for (const h of MEETING_HEADINGS) await expect(preview.getByRole('heading', { name: h })).toBeVisible();

    await picker(page).getByRole('button', { name: 'Use template' }).click();
    await expect(picker(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));

    for (const h of MEETING_HEADINGS) await expect(pageBody(page).getByRole('heading', { name: h })).toBeVisible();
    await page.reload();
    for (const h of MEETING_HEADINGS) await expect(pageBody(page).getByRole('heading', { name: h })).toBeVisible();

    await page.goto(spaceUrl);
    await sidebarNewPage(page).click();
    await pickBlankPage(page);
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    await expect(pageBody(page).locator('h2')).toHaveCount(0);
  });

  test('saving a page as a template, and reusing it for a new page (dark mode too)', async ({ page }) => {
    await logIn(page, editorB, launchPlanPath);

    await page.getByRole('button', { name: 'Save as template' }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save as template' });
    await expect(saveDialog.getByLabel('Name')).toHaveValue('Launch Plan');
    await saveDialog.getByLabel('Short description').fill('For a feature going out.');
    await saveDialog.getByRole('button', { name: 'Save template' }).click();
    await expect(page.locator('.template-saved')).toHaveText('Saved as template “Launch Plan”. It is in the picker for new pages in this space.');

    // Make a page from it; the picker is checked once in dark mode.
    await page.goto(spaceUrl);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await pickTemplate(page, 'Launch Plan');
    await expect(picker(page).locator('.picker-preview-body')).toContainText('Rollout');
    await expect(picker(page).locator('.picker-preview-body')).toContainText('Ship');
    await page.screenshot({ path: 'test-results/templates-dark.png', fullPage: true });
    await picker(page).getByRole('button', { name: 'Use template' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    await expect(pageBody(page).getByRole('heading', { name: 'Rollout' })).toBeVisible();
    await expect(pageBody(page).locator('table')).toContainText('Ship');
  });
});
