// Stage 8b templates, part 2 of 4 (see templates-builtin.spec.ts): saving a
// page as a template in the "Save as template" dialog, and making a new page
// from it in the picker. Part 3 (templates-edit.spec.ts) edits and deletes it.
import { test, expect } from '../fixtures';
import { editorB, pageBody, pickTemplate, picker, setUpTemplateYard, spaceKey, spaceUrl, switchUser } from '../templates-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('templates: saved from a page', () => {
  test.beforeAll(resetDatabase);

  test('saving a page as a template, and reusing it for a new page', async ({ page }) => {
    const launchPlan = await setUpTemplateYard(page);
    await switchUser(page, editorB, launchPlan.path);

    await page.getByRole('button', { name: 'Save as template' }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save as template' });
    await expect(saveDialog.getByLabel('Name')).toHaveValue('Launch Plan');
    await saveDialog.getByLabel('Short description').fill('For a feature going out.');
    await saveDialog.getByRole('button', { name: 'Save template' }).click();
    await expect(page.locator('.template-saved')).toHaveText('Saved as template “Launch Plan”. It is in the picker for new pages in this space.');

    // Make a page from it.
    await page.goto(spaceUrl);
    await pickTemplate(page, 'Launch Plan');
    await expect(picker(page).locator('.picker-preview-body')).toContainText('Rollout');
    await expect(picker(page).locator('.picker-preview-body')).toContainText('Ship');
    await picker(page).getByRole('button', { name: 'Use template' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    await expect(pageBody(page).getByRole('heading', { name: 'Rollout' })).toBeVisible();
    await expect(pageBody(page).locator('table')).toContainText('Ship');
  });
});
