// Shared by comments.spec.ts (lean suite row 30): the people, the
// two-paragraph page they talk about, and the panel locators.
import { expect, type Page } from './fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from './login';

export const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };

/** Block id given to the second paragraph, so API comments can point at it. */
export const SECOND_BLOCK = 'b0c0ffee-0000-4000-8000-000000000002';

export const panel = (page: Page) => page.getByRole('complementary', { name: 'Comments' });
export const toggle = (page: Page) => page.getByRole('button', { name: 'Comments' });
export const badge = (page: Page) => page.locator('.count-badge');

export async function openComments(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
  await expect(panel(page)).toBeVisible();
}

/** Log in as `user` instead, landing straight on `path`. */
export async function switchUser(page: Page, user: { email: string; password: string }, path: string) {
  await page.context().clearCookies();
  await logIn(page, user, path);
}

/**
 * Admin signs up, makes a space editors can write in and a page with two
 * paragraphs ("First paragraph", "Second paragraph"), and adds Beck
 * (editor). Leaves the admin logged in. Returns the page id and path.
 */
export async function setUpSharedNotes(page: Page): Promise<{ id: string; path: string }> {
  await signUp(page, admin);
  await createSpace(page, { name: 'Comments Room', key: 'comments-room', defaultRole: 'editor' });
  const created = await createPage(page, 'comments-room', {
    title: 'Shared notes',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'b0c0ffee-0000-4000-8000-000000000001' }, content: [{ type: 'text', text: 'First paragraph' }] },
        { type: 'paragraph', attrs: { id: SECOND_BLOCK }, content: [{ type: 'text', text: 'Second paragraph' }] },
      ],
    },
  });
  await addPerson(page, editorB, 'editor');
  return created;
}
