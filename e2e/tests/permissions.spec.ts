// Item 5a (docs/done-checks/05-loop-criteria.md): per-space permissions and
// nested pages, proven on screen. Ada (admin) has a members-only space A with
// Eve as its editor, and an open space B. Otto is a plain editor outside A:
// A does not exist for him, in the list, by URL or through the API. Eve can
// edit A until Ada removes her. Also: a sub-page sits under its parent in
// the tree, and logging out and back in works.
import { test, expect, type Browser, type Page } from '../fixtures';
import { addPerson, contextFor, createPage, createSpace, logIn, logInWithForm, pickBlankPage, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const ada = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const eve = { name: 'Eve Member', email: 'eve@stillwater.test', password: 'member horse battery' };
const otto = { name: 'Otto Outsider', email: 'otto@stillwater.test', password: 'battery horse correct' };

const A = { name: 'Harbour Plans', key: 'harbour-plans' };
const B = { name: 'Open Field', key: 'open-field' };
const PARENT = 'Mooring layout';
const CHILD = 'Buoy colours';

let parentUrl = '';
let childUrl = '';

/** A fresh browser (own cookies) logged in as `user` from its saved storageState; the caller opens the first page. */
async function session(browser: Browser, user: { email: string; password: string }) {
  const context = await contextFor(browser, user);
  const page = await context.newPage();
  return { context, page };
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Pages in this space' });
const body = (page: Page) => page.locator('.page-editor .ProseMirror');
// Takes a full URL or a path (parentUrl is a path: the page is made through the API).
const pageIdOf = (url: string) => new URL(url, 'http://x').pathname.split('/p/')[1];

async function setTitle(page: Page, title: string) {
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('Page title').blur();
  await expect(page.getByLabel('Page title')).toHaveValue(title);
}

/** The calm "Nothing here" screen, and none of A's content. */
async function expectRefused(page: Page) {
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  await expect(page.getByText('does not exist, or you do not have access to it')).toBeVisible();
  await expect(page.getByText(PARENT)).toHaveCount(0);
  await expect(page.getByText(CHILD)).toHaveCount(0);
  await expect(page.locator('.page-editor')).toHaveCount(0);
}

test.describe.serial('per-space permissions and nested pages', () => {
  test.beforeAll(resetDatabase);

  test('Ada sets up a members-only space with Eve as its editor, and an open space', async ({ page }) => {
    // Accounts and spaces come from the API (the sign-up form and the "New
    // space" dialog are proven in wiki.spec.ts and search.spec.ts); the clicks
    // here are the space settings form, which is what this test is about.
    await signUp(page, ada);
    await addPerson(page, eve, 'editor');
    await addPerson(page, otto, 'editor');
    await createSpace(page, { ...A, visibility: 'restricted' });
    await createSpace(page, { ...B, visibility: 'open' });

    await page.goto(`/s/${A.key}`);
    await expect(sidebar(page).getByLabel('Members only')).toBeVisible();

    // Space settings: add Eve as an editor of A.
    await sidebar(page).getByRole('link', { name: 'Space settings' }).click();
    await expect(page).toHaveURL(`/s/${A.key}/settings`);
    await page.getByLabel('Person to add').selectOption({ label: `${eve.name} (${eve.email})` });
    await page.getByLabel('Role for new member').selectOption('editor');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('.member-list')).toContainText(eve.name);
    await expect(page.getByLabel(`Role for ${eve.name}`)).toHaveValue('editor');
    // Otto is not offered as a member yet, and is not one.
    await expect(page.locator('.member-list')).not.toContainText(otto.name);

    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
    await expect(sidebar(page).getByLabel('Members only')).toHaveCount(0);
  });

  test('a sub-page sits under its parent in the tree and reopens by its URL', async ({ page }) => {
    // The parent comes from the API; the sub-page is made with the Sub-page
    // button, the click this test is about.
    await logIn(page, ada, null);
    parentUrl = (await createPage(page, A.key, { title: PARENT })).path;
    await page.goto(parentUrl);
    await expect(page.getByLabel('Page title')).toHaveValue(PARENT);

    await page.getByRole('button', { name: 'Sub-page', exact: true }).click();
    await pickBlankPage(page);
    await expect(page).not.toHaveURL(parentUrl);
    await expect(page).toHaveURL(new RegExp(`/s/${A.key}/p/.+`));
    await setTitle(page, CHILD);
    childUrl = page.url();

    // In the tree, the child link lives inside the parent's nested list.
    const parentRow = sidebar(page).locator('li', { has: page.getByRole('link', { name: PARENT, exact: true }) }).first();
    const nested = parentRow.locator('.tree-children');
    await expect(nested.getByRole('link', { name: CHILD, exact: true })).toBeVisible();
    // ...and only there: the space's top level lists the parent, not the child.
    await page.goto(`/s/${A.key}`);
    const topList = page.getByRole('main').locator('.list');
    await expect(topList.getByRole('link', { name: PARENT, exact: true })).toBeVisible();
    await expect(topList.getByRole('link', { name: CHILD, exact: true })).toHaveCount(0);

    // Reopening the sub-page by its URL: breadcrumb shows the parent.
    await page.goto(childUrl);
    await expect(page.getByLabel('Page title')).toHaveValue(CHILD);
    await expect(page.locator('.crumb').getByRole('link', { name: PARENT, exact: true })).toBeVisible();
    await expect(nested.getByRole('link', { name: CHILD, exact: true })).toBeVisible();

    // The parent lists it under "Sub-pages".
    await page.goto(parentUrl);
    await expect(page.locator('.subpages').getByRole('link', { name: CHILD, exact: true })).toBeVisible();
  });

  test('Otto, outside the space, cannot see it in the list, by URL, or through the API', async ({ page }) => {
    await logIn(page, otto);

    // Home: the open space is there, the members-only one is not.
    const cards = page.locator('.cards');
    await expect(cards.getByRole('link', { name: new RegExp(B.name) })).toBeVisible();
    await expect(cards.getByRole('link', { name: new RegExp(A.name) })).toHaveCount(0);
    await expect(page.getByText(A.name)).toHaveCount(0);

    // Open space B works for him, and its sidebar does not leak A.
    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
    await expect(sidebar(page)).not.toContainText(A.name);

    // A's space, page and sub-page URLs all land on the calm not-found screen.
    for (const url of [`/s/${A.key}`, parentUrl, childUrl]) {
      await page.goto(url);
      await expectRefused(page);
    }

    // The API agrees: a space you cannot read does not exist for you.
    for (const url of [parentUrl, childUrl]) {
      const res = await page.request.get(`/api/pages/${pageIdOf(url)}`);
      expect(res.status()).toBe(404);
      expect(await res.text()).not.toContain(PARENT);
    }
    const write = await page.request.put(`/api/pages/${pageIdOf(parentUrl)}`, {
      data: { baseVersion: 1, title: 'Taken over', doc: { type: 'doc', content: [] } },
    });
    expect(write.status()).toBe(404);
  });

  test('Eve, an editor of the space, opens and edits its page and sub-page', async ({ page }) => {
    await logIn(page, eve);
    await expect(page.locator('.cards').getByRole('link', { name: new RegExp(A.name) })).toBeVisible();

    await page.goto(`/s/${A.key}`);
    await expect(sidebar(page).locator('.sidebar-foot .pill')).toHaveText('Editor');

    for (const [url, word] of [
      [parentUrl, 'anchorage'],
      [childUrl, 'starboard'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByLabel('Page title')).toBeEditable();
      await body(page).click();
      await page.keyboard.type(`Eve wrote ${word}`);
      await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
      await page.reload();
      await expect(body(page)).toContainText(`Eve wrote ${word}`);
    }
  });

  test('when Ada removes Eve from the space, Eve loses it after a reload', async ({ browser }) => {
    const asEve = await session(browser, eve);
    const asAda = await session(browser, ada);
    try {
      await asEve.page.goto(parentUrl);
      await expect(asEve.page.getByLabel('Page title')).toHaveValue(PARENT);

      await asAda.page.goto(`/s/${A.key}/settings`);
      await asAda.page.getByRole('button', { name: `Remove ${eve.name}` }).click();
      await expect(asAda.page.locator('.member-list')).not.toContainText(eve.name);

      await asEve.page.reload();
      await expectRefused(asEve.page);
      await asEve.page.goto(childUrl);
      await expectRefused(asEve.page);
      const res = await asEve.page.request.get(`/api/pages/${pageIdOf(parentUrl)}`);
      expect(res.status()).toBe(404);

      await asEve.page.goto('/');
      await expect(asEve.page.locator('.cards').getByRole('link', { name: new RegExp(B.name) })).toBeVisible();
      await expect(asEve.page.getByText(A.name)).toHaveCount(0);
    } finally {
      await asEve.context.close();
      await asAda.context.close();
    }
  });

  test('logging out ends the session, and logging back in restores it', async ({ page }) => {
    await logInWithForm(page, otto);
    await expect(page.locator('.who-name')).toHaveText(otto.name);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL('/login');

    // The session is really gone: the app sends you back, the API refuses.
    await page.goto(`/s/${B.key}`);
    await expect(page).toHaveURL('/login');
    const me = await page.request.get('/api/spaces');
    expect(me.status()).toBe(401);

    await logInWithForm(page, otto);
    await expect(page.locator('.who-name')).toHaveText(otto.name);
    await page.goto(`/s/${B.key}`);
    await expect(page.getByRole('heading', { name: B.name })).toBeVisible();
  });
});
