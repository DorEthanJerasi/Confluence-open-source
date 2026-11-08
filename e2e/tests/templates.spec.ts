// Stage 8b templates on screen (docs/done-checks/08-templates.md, 8b E2E
// list): a new page from a built-in template, saving a page as a template
// and reusing/editing/deleting it, and a viewer seeing no template control
// anywhere.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, pickBlankPage, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };

const spaceKey = 'template-yard';
const spaceUrl = `/s/${spaceKey}`;
const templatesTabUrl = `${spaceUrl}/settings/templates`;

let setupPageUrl = '';
let pageMadeBeforeEdit = '';

// A page with a heading and a table, the shape the "save as template, reuse"
// box needs. Same node types the server's built-ins use (apps/server/src/templates/builtin.ts).
const SETUP_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Rollout' }] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ada' }] }] },
          ],
        },
      ],
    },
  ],
};

const MEETING_HEADINGS = ['Details', 'People', 'Agenda', 'Notes', 'Decisions', 'Next steps'];

const sidebarNewPage = (page: Page) =>
  page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' });
const picker = (page: Page) => page.getByRole('dialog', { name: 'New page' });
const pageBody = (page: Page) => page.locator('.page-editor .ProseMirror');

async function switchUser(page: Page, user: { email: string; password: string }, to: string) {
  await page.context().clearCookies();
  await logIn(page, user, to);
}

/** Opens the picker from the sidebar and chooses the template whose name starts with `name`. */
async function pickTemplate(page: Page, name: string) {
  await sidebarNewPage(page).click();
  await expect(picker(page)).toBeVisible();
  await picker(page)
    .getByRole('option', { name: new RegExp('^' + name) })
    .click();
}

test.describe.serial('templates', () => {
  test.beforeAll(resetDatabase);

  test('a new page from a built-in template has its headings, and Blank page still makes an empty one', async ({ page }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Template Yard', key: spaceKey, defaultRole: 'editor' });
    setupPageUrl = (await createPage(page, spaceKey, { title: 'Launch Plan', doc: SETUP_DOC })).path;
    await addPerson(page, editorB, 'editor');
    await addPerson(page, viewerC, 'viewer');

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

  test('saving a page as a template, reusing it, editing it and deleting it, checked once in dark mode', async ({ page }) => {
    await switchUser(page, editorB, setupPageUrl);

    await page.getByRole('button', { name: 'Save as template' }).click();
    const saveDialog = page.getByRole('dialog', { name: 'Save as template' });
    await expect(saveDialog.getByLabel('Name')).toHaveValue('Launch Plan');
    await saveDialog.getByLabel('Short description').fill('For a feature going out.');
    await saveDialog.getByRole('button', { name: 'Save template' }).click();
    await expect(page.locator('.template-saved')).toHaveText('Saved as template “Launch Plan”. It is in the picker for new pages in this space.');

    // Make a page from it now, before the template is edited.
    await page.goto(spaceUrl);
    await pickTemplate(page, 'Launch Plan');
    await expect(picker(page).locator('.picker-preview-body')).toContainText('Rollout');
    await expect(picker(page).locator('.picker-preview-body')).toContainText('Ship');
    await picker(page).getByRole('button', { name: 'Use template' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${spaceKey}/p/.+`));
    pageMadeBeforeEdit = page.url();
    await expect(pageBody(page).getByRole('heading', { name: 'Rollout' })).toBeVisible();
    await expect(pageBody(page).locator('table')).toContainText('Ship');

    // Edit the template's text in the Templates tab.
    await page.goto(templatesTabUrl);
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

  test('a viewer sees no template control anywhere', async ({ page }) => {
    await switchUser(page, viewerC, spaceUrl);
    await expect(page.getByRole('button', { name: 'New page' })).toHaveCount(0);

    await page.goto(pageMadeBeforeEdit);
    await expect(page.getByRole('button', { name: 'Save as template' })).toHaveCount(0);

    await page.goto(templatesTabUrl);
    await expect(page).toHaveURL(`${spaceUrl}/settings`);
    await expect(page.getByRole('link', { name: 'Templates' })).toHaveCount(0);
  });
});
