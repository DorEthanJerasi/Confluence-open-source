// Shared by the templates*.spec.ts files (done-check 08, 8b E2E): the
// people, the space, the page with a heading and a table, and the picker
// locators. Each file runs on its own and builds what it needs through the
// API helpers in login.ts, so the files can land on different workers.
import { expect, type Page } from './fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from './login';

export const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
export const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };

export const spaceKey = 'template-yard';
export const spaceUrl = `/s/${spaceKey}`;
export const templatesTabUrl = `${spaceUrl}/settings/templates`;

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

export async function switchUser(page: Page, user: { email: string; password: string }, to: string) {
  await page.context().clearCookies();
  await logIn(page, user, to);
}

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
 * page with a heading and a table, and adds Beck (editor) and Cleo (viewer).
 * Leaves the admin logged in. Returns the Launch Plan page's id and URL path.
 */
export async function setUpTemplateYard(page: Page): Promise<{ id: string; path: string }> {
  await signUp(page, admin);
  await createSpace(page, { name: 'Template Yard', key: spaceKey, defaultRole: 'editor' });
  const launchPlan = await createPage(page, spaceKey, { title: 'Launch Plan', doc: SETUP_DOC });
  await addPerson(page, editorB, 'editor');
  await addPerson(page, viewerC, 'viewer');
  return launchPlan;
}

/**
 * What the first half of templates-saved.spec.ts does on screen, made
 * through the API as Beck: saves the Launch Plan page as the "Launch Plan"
 * template (the "Save as template" dialog's call), then makes a page from it
 * (the picker's "Use template" call). Leaves Beck logged in. Returns that
 * page's URL path.
 */
export async function saveLaunchPlanTemplate(page: Page, launchPlanId: string): Promise<string> {
  await page.context().clearCookies();
  await logIn(page, editorB, null);
  const res = await page.request.post(`/api/spaces/${spaceKey}/templates`, {
    data: { name: 'Launch Plan', description: 'For a feature going out.', fromPageId: launchPlanId },
  });
  expect(res.status(), 'save Launch Plan as a template').toBe(201);
  const { template } = (await res.json()) as { template: { id: string } };
  const made = await page.request.post(`/api/spaces/${spaceKey}/pages`, { data: { templateId: template.id } });
  expect(made.status(), 'make a page from the Launch Plan template').toBe(201);
  const { page: created } = (await made.json()) as { page: { id: string } };
  return `/s/${spaceKey}/p/${created.id}`;
}
