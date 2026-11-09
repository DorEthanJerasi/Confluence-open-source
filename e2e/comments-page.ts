// Shared by the three comments spec files (comments*.spec.ts): the people,
// the two-paragraph page they talk about, and the panel locators. Each file
// runs on its own and builds what it needs through the API helpers in
// login.ts, so the files can land on different workers.
import { expect, type Page } from './fixtures';
import { addComment, addPerson, createPage, createSpace, logIn, signUp } from './login';

export const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
export const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };

/** Block id given to the second paragraph, so API comments can point at it. */
export const SECOND_BLOCK = 'b0c0ffee-0000-4000-8000-000000000002';

export const panel = (page: Page) => page.getByRole('complementary', { name: 'Comments' });
export const toggle = (page: Page) => page.getByRole('button', { name: 'Comments' });
export const badge = (page: Page) => page.locator('.count-badge');
export const blockThread = (page: Page) => panel(page).locator('.comment-thread[aria-label="Thread on a block"]');
export const pageThread = (page: Page) => panel(page).locator('.comment-thread[aria-label="Thread on the page"]');

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
 * paragraphs ("First paragraph", "Second paragraph"), and adds Beck (editor)
 * and Cleo (viewer). Leaves the admin logged in. Returns the page id and path.
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
  await addPerson(page, viewerC, 'viewer');
  return created;
}

/**
 * What the first comments test leaves behind, made through the API: Beck's
 * comment on the second paragraph and Beck's comment on the page. With
 * `withReply`, Cleo has also replied to the block comment (what the second
 * test leaves behind). Leaves nobody logged in.
 */
export async function addBecksComments(page: Page, pageId: string, withReply = false): Promise<void> {
  await page.context().clearCookies();
  await logIn(page, editorB, null);
  const blockComment = await addComment(page, pageId, { body: 'Should this say "Cleo" or "Cleo V"?', blockId: SECOND_BLOCK });
  await addComment(page, pageId, { body: 'Nice start on these notes.' });
  if (withReply) {
    await page.context().clearCookies();
    await logIn(page, viewerC, null);
    await addComment(page, pageId, { body: 'Looks fine to me.', parentId: blockComment });
  }
  await page.context().clearCookies();
}
