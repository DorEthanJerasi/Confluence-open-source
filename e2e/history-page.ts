// Shared by the history*.spec.ts files (done-check 03, 3c E2E): the people,
// the shared page and its versions, and the history panel locators. Each file
// runs on its own and builds what it needs through the API helpers in
// login.ts, so the files can land on different workers.
import { expect, type Page } from './fixtures';
import { addPerson, createPage, createSpace, logIn, restorePageVersion, savePage, signUp } from './login';

export const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
export const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };

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

/** Log in as `user` instead, landing straight on `path`. */
export async function switchUser(page: Page, user: { email: string; password: string }, path: string) {
  await page.context().clearCookies();
  await logIn(page, user, path);
}

/**
 * Admin signs up, makes the open space (editors can write) and the shared
 * page with "first text" (its first version), and adds Beck (editor) and
 * Cleo (viewer). Leaves the admin logged in.
 */
export async function setUpSharedPage(page: Page): Promise<{ id: string; path: string; version: number }> {
  await signUp(page, admin);
  await createSpace(page, SPACE);
  const created = await createPage(page, SPACE.key, { title: TITLE, doc: docWith('first text') });
  await addPerson(page, editorB, 'editor');
  await addPerson(page, viewerC, 'viewer');
  return created;
}

export type Versions = { path: string; firstVersion: number; secondVersion: number; restoreVersion?: number };

/**
 * What history-list.spec.ts leaves behind, made through the API: the admin's
 * first version ("first text") and Beck's second ("second text", same block).
 * With `restored`, Beck has also restored the first version (what
 * history-restore.spec.ts does on screen). Leaves nobody logged in.
 */
export async function setUpVersions(page: Page, restored = false): Promise<Versions> {
  const created = await setUpSharedPage(page);
  await page.context().clearCookies();
  await logIn(page, editorB, null);
  const secondVersion = await savePage(page, created.id, { baseVersion: created.version, title: TITLE, doc: docWith('second text') });
  const versions: Versions = { path: created.path, firstVersion: created.version, secondVersion };
  if (restored) versions.restoreVersion = await restorePageVersion(page, created.id, created.version, secondVersion);
  await page.context().clearCookies();
  return versions;
}
