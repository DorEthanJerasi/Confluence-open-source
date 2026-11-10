// Shared by templates.spec.ts (lean suite row 33): the people, the space,
// the page with a heading and a table, and the picker locators.
import { expect, type Page } from './fixtures';
import { addPerson, createPage, createSpace, signUp } from './login';

export const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };

export const spaceKey = 'template-yard';
export const spaceUrl = `/s/${spaceKey}`;

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

export const sidebarNewPage = (page: Page) =>
  page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' });
export const picker = (page: Page) => page.getByRole('dialog', { name: 'New page' });
export const pageBody = (page: Page) => page.locator('.page-editor .ProseMirror');

/** Opens the picker from the sidebar and chooses the template whose name starts with `name`. */
export async function pickTemplate(page: Page, name: string) {
  await sidebarNewPage(page).click();
  await expect(picker(page)).toBeVisible();
  await picker(page)
    .getByRole('option', { name: new RegExp('^' + name) })
    .click();
}

/**
 * Admin signs up, makes the space (editors can write) and the "Launch Plan"
 * page with a heading and a table, and adds Beck (editor).
 * Leaves the admin logged in. Returns the Launch Plan page's id and URL path.
 */
export async function setUpTemplateYard(page: Page): Promise<{ id: string; path: string }> {
  await signUp(page, admin);
  await createSpace(page, { name: 'Template Yard', key: spaceKey, defaultRole: 'editor' });
  const launchPlan = await createPage(page, spaceKey, { title: 'Launch Plan', doc: SETUP_DOC });
  await addPerson(page, editorB, 'editor');
  return launchPlan;
}
