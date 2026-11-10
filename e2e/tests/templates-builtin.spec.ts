// Stage 8b templates on screen (docs/done-checks/08-templates.md, 8b E2E
// list), part 1 of 4 (the others are templates-saved, -edit and -viewer;
// shared set-up in e2e/templates-page.ts). Here: a new page from a built-in
// template, and Blank page still making an empty one.
import { test, expect } from '../fixtures';
import { pickBlankPage } from '../login';
import { editorB, pageBody, pickTemplate, picker, setUpTemplateYard, sidebarNewPage, spaceKey, spaceUrl, switchUser } from '../templates-page';
import { resetDatabase } from '../reset-db';

const MEETING_HEADINGS = ['Details', 'People', 'Agenda', 'Notes', 'Decisions', 'Next steps'];

test.describe.serial('templates: built-in', () => {
  test.beforeAll(resetDatabase);

  test('a new page from a built-in template has its headings, and Blank page still makes an empty one', async ({ page }) => {
    await setUpTemplateYard(page);

    await switchUser(page, editorB, spaceUrl);
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
});
