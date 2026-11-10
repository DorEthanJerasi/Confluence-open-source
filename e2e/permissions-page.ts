// Shared by the permissions*.spec.ts files (done-check 05, item 5a): the
// people, the two spaces, the parent page and its sub-page, and the
// locators. Each file runs on its own and builds what it needs through the
// API helpers in login.ts, so the files can land on different workers.
//
// Ada (admin) has a members-only space A with Eve as its editor, and an open
// space B. Otto is a plain editor outside A.
import { expect, type Browser, type Page } from './fixtures';
import { addMember, addPerson, contextFor, createPage, createSpace, signUp } from './login';

export const ada = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const eve = { name: 'Eve Member', email: 'eve@stillwater.test', password: 'member horse battery' };
export const otto = { name: 'Otto Outsider', email: 'otto@stillwater.test', password: 'battery horse correct' };

export const A = { name: 'Harbour Plans', key: 'harbour-plans' };
export const B = { name: 'Open Field', key: 'open-field' };
export const PARENT = 'Mooring layout';
export const CHILD = 'Buoy colours';

/** A fresh browser (own cookies) logged in as `user`; the caller opens the first page. */
export async function session(browser: Browser, user: { email: string; password: string }) {
  const context = await contextFor(browser, user);
  const page = await context.newPage();
  return { context, page };
}

export const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Pages in this space' });
export const body = (page: Page) => page.locator('.page-editor .ProseMirror');
// Takes a full URL or a path (the set-up pages are made through the API, so their URLs are paths).
export const pageIdOf = (url: string) => new URL(url, 'http://x').pathname.split('/p/')[1];

export async function setTitle(page: Page, title: string) {
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('Page title').blur();
  await expect(page.getByLabel('Page title')).toHaveValue(title);
}

/** The calm "Nothing here" screen, and none of A's content. */
export async function expectRefused(page: Page) {
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  await expect(page.getByText('does not exist, or you do not have access to it')).toBeVisible();
  await expect(page.getByText(PARENT)).toHaveCount(0);
  await expect(page.getByText(CHILD)).toHaveCount(0);
  await expect(page.locator('.page-editor')).toHaveCount(0);
}

/**
 * What permissions-settings.spec.ts sets up on screen, made through the API:
 * Ada signs up, adds Eve and Otto as editors, makes the members-only space A
 * with Eve as its editor and the open space B. Leaves Ada logged in.
 */
export async function setUpSpaces(page: Page): Promise<void> {
  await signUp(page, ada);
  const eveId = await addPerson(page, eve, 'editor');
  await addPerson(page, otto, 'editor');
  await createSpace(page, { ...A, visibility: 'restricted' });
  await createSpace(page, { ...B, visibility: 'open' });
  await addMember(page, A.key, eveId, 'editor');
}

/**
 * setUpSpaces, plus what permissions-subpage.spec.ts makes: the parent page
 * in A and its sub-page under it, both empty. Leaves Ada logged in. Returns
 * both pages' URL paths.
 */
export async function setUpHarbour(page: Page): Promise<{ parentUrl: string; childUrl: string }> {
  await setUpSpaces(page);
  const parent = await createPage(page, A.key, { title: PARENT });
  const child = await createPage(page, A.key, { title: CHILD, parentId: parent.id });
  return { parentUrl: parent.path, childUrl: child.path };
}
