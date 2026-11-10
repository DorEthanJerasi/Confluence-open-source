// Shared by history.spec.ts (lean suite rows 21-24): the people, the shared
// page and the history panel locators.
import { expect, type Page } from './fixtures';
import { addPerson, createPage, createSpace, signUp } from './login';

export const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };

export const SPACE = { name: 'Open Room', key: 'open-room', defaultRole: 'editor' as const };
export const TITLE = 'Shared notes';

/** Block id of the page's one paragraph, the same in every version, so the diff reports it "changed". */
const PARAGRAPH = 'b0c0ffee-0000-4000-8000-0000000000a1';
const docWith = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { id: PARAGRAPH }, content: [{ type: 'text', text }] }],
});

export const body = (page: Page) => page.locator('.page-editor .ProseMirror');
export const panel = (page: Page) => page.getByRole('complementary', { name: 'Page history' });
export const row = (page: Page, version: number) => panel(page).locator(`[data-version="${version}"]`);

export async function openHistory(page: Page) {
  const toggle = page.getByRole('button', { name: 'History' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(panel(page)).toBeVisible();
}

/**
 * Admin signs up, makes the open space (editors can write) and the shared
 * page with "first text" (its first version), and adds Beck (editor).
 * Leaves the admin logged in.
 */
export async function setUpSharedPage(page: Page): Promise<{ id: string; path: string; version: number }> {
  await signUp(page, admin);
  await createSpace(page, SPACE);
  const created = await createPage(page, SPACE.key, { title: TITLE, doc: docWith('first text') });
  await addPerson(page, editorB, 'editor');
  return created;
}
