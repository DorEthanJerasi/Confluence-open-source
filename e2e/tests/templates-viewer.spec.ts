// Stage 8b templates, part 4 of 4 (see templates-builtin.spec.ts): a viewer
// sees no template control anywhere: no New page button, no "Save as
// template" on a page, no Templates tab. The page comes from the API.
import { test, expect } from '../fixtures';
import { setUpTemplateYard, spaceUrl, switchUser, templatesTabUrl, viewerC } from '../templates-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('templates: a viewer', () => {
  test.beforeAll(resetDatabase);

  test('a viewer sees no template control anywhere', async ({ page }) => {
    const { path: pageUrl } = await setUpTemplateYard(page);
    await switchUser(page, viewerC, spaceUrl);
    await expect(page.getByRole('button', { name: 'New page' })).toHaveCount(0);

    await page.goto(pageUrl);
    await expect(page.getByRole('button', { name: 'Save as template' })).toHaveCount(0);

    await page.goto(templatesTabUrl);
    await expect(page).toHaveURL(`${spaceUrl}/settings`);
    await expect(page.getByRole('link', { name: 'Templates' })).toHaveCount(0);
  });
});
