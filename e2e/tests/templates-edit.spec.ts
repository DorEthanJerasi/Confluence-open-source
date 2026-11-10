// Stage 8b templates, part 3 of 4 (see templates-builtin.spec.ts): editing a
// saved template in the Templates tab changes new pages but not a page made
// before the edit, and deleting it takes it out of the picker, checked once
// in dark mode. Starts from what part 2 leaves behind (the "Launch Plan"
// template and a page made from it), made through the API.
import { test, expect } from '../fixtures';
import { logIn } from '../login';
import {
  editorB,
  pageBody,
  pickTemplate,
  picker,
  saveLaunchPlanTemplate,
  setUpTemplateYard,
  sidebarNewPage,
  spaceKey,
  spaceUrl,
  templatesTabUrl,
} from '../templates-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('templates: edit and delete', () => {
  test.beforeAll(resetDatabase);

  test('editing a saved template and deleting it, checked once in dark mode', async ({ page }) => {
    const launchPlan = await setUpTemplateYard(page);
    const pageMadeBeforeEdit = await saveLaunchPlanTemplate(page, launchPlan.id);

    // Edit the template's text in the Templates tab.
    await logIn(page, editorB, templatesTabUrl);
    const row = page.locator('.template-row', { hasText: 'Launch Plan' });
    await row.getByRole('button', { name: 'Edit Launch Plan' }).click();
    const templateBody = page.locator('.template-editor-doc .ProseMirror');
    await templateBody.getByRole('heading', { name: 'Rollout' }).click();
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.keyboard.type('Rollout plan v2');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // A page made from the template now gets the change...
    await page.getByRole('button', { name: 'Back to templates' }).click();
    await page.goto(spaceUrl);
    await pickTemplate(page, 'Launch Plan');
    await picker(page).getByRole('button', { name: 'Use template' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    await expect(pageBody(page).getByRole('heading', { name: 'Rollout plan v2' })).toBeVisible();

    // ...but the page made before the edit does not.
    await page.goto(pageMadeBeforeEdit);
    await expect(pageBody(page).getByRole('heading', { name: 'Rollout' })).toBeVisible();
    await expect(pageBody(page).getByRole('heading', { name: 'Rollout plan v2' })).toHaveCount(0);

    // Delete the template; it is gone from the picker. Checked in dark mode.
    await page.goto(templatesTabUrl);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.locator('.template-row', { hasText: 'Launch Plan' }).getByRole('button', { name: 'Delete Launch Plan' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete “Launch Plan”?' });
    await expect(confirm).toBeVisible();
    await page.screenshot({ path: 'test-results/templates-dark.png', fullPage: true });
    await confirm.getByRole('button', { name: 'Delete template' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator('.template-row', { hasText: 'Launch Plan' })).toHaveCount(0);

    await page.goto(spaceUrl);
    await sidebarNewPage(page).click();
    await expect(picker(page)).toBeVisible();
    await expect(picker(page).getByRole('option', { name: /^Launch Plan/ })).toHaveCount(0);
  });
});
