// Stage 07 page comments on screen (docs/done-checks/07-comments.md, 7b
// Playwright boxes): an editor comments on a block and on the page, a viewer
// can reply but not resolve or edit someone else's comment, and the author
// can edit and delete their own. Set-up (people, space, page with two
// paragraphs) goes through the API helpers in e2e/login.ts; the two-paragraph
// doc itself is posted the same way createPage posts a one-paragraph one.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const editorB = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };
const viewerC = { name: 'Cleo Viewer', email: 'cleo@stillwater.test', password: 'horse battery correct' };

let pageUrl = '';
let blockId = '';

/** Log in as `user` instead, landing straight on the shared page. */
async function switchUser(page: Page, user: { email: string; password: string }) {
  await page.context().clearCookies();
  await logIn(page, user, pageUrl);
}

/** A page with two paragraphs, made the way createPage makes a one-paragraph one. */
async function createTwoParaPage(page: Page, spaceKey: string, title: string): Promise<{ id: string; path: string }> {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
    ],
  };
  const res = await page.request.post(`/api/spaces/${spaceKey}/pages`, { data: { title, parentId: null, doc } });
  expect(res.status(), `create page "${title}" in ${spaceKey}`).toBe(201);
  const { page: created } = (await res.json()) as { page: { id: string } };
  return { id: created.id, path: `/s/${spaceKey}/p/${created.id}` };
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Comments' });
const toggle = (page: Page) => page.getByRole('button', { name: 'Comments' });
const badge = (page: Page) => page.locator('.count-badge');
const blockThread = (page: Page) => panel(page).locator('.comment-thread[aria-label="Thread on a block"]');
const pageThread = (page: Page) => panel(page).locator('.comment-thread[aria-label="Thread on the page"]');

async function openComments(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
  await expect(panel(page)).toBeVisible();
}

test.describe.serial('page comments', () => {
  test.beforeAll(resetDatabase);

  test('an editor comments on the second paragraph and on the page; the marker and count survive a reload', async ({
    page,
  }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Comments Room', key: 'comments-room', defaultRole: 'editor' });
    const created = await createTwoParaPage(page, 'comments-room', 'Shared notes');
    pageUrl = created.path;
    await addPerson(page, editorB, 'editor');
    await addPerson(page, viewerC, 'viewer');

    await switchUser(page, editorB);
    const secondPara = page.locator('.page-editor .ProseMirror > p', { hasText: 'Second paragraph' });
    blockId = (await secondPara.getAttribute('data-block-id')) ?? '';
    expect(blockId).not.toBe('');

    await secondPara.hover();
    await page.locator('.comment-add').click();
    await panel(page).getByLabel('Your comment on this block').fill('Should this say "Cleo" or "Cleo V"?');
    await page.locator('.comment-new-block').getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.locator('.comment-new-block')).toHaveCount(0);

    await panel(page).getByLabel('Comment on this page').fill('Nice start on these notes.');
    await page.locator('.comment-page-composer').getByRole('button', { name: 'Comment', exact: true }).click();

    await expect(panel(page).locator('.comment-thread')).toHaveCount(2);
    await expect(badge(page)).toHaveText('2');
    await expect(page.locator(`.comment-gutter[data-block="${blockId}"] .comment-marker`)).toBeVisible();

    await page.reload();
    await expect(page.locator(`.comment-gutter[data-block="${blockId}"] .comment-marker`)).toBeVisible();
    await expect(badge(page)).toHaveText('2');
    await openComments(page);
    await expect(panel(page).locator('.comment-thread')).toHaveCount(2);
  });

  test('a viewer can read and reply but not resolve or edit the editor\'s comments; the editor resolves and reopens', async ({
    page,
  }) => {
    await switchUser(page, viewerC);
    await openComments(page);
    await expect(panel(page).locator('.comment-thread')).toHaveCount(2);

    const thread = blockThread(page);
    await expect(thread.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    await expect(thread.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(thread.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await thread.getByRole('button', { name: 'Reply', exact: true }).click();
    await thread.locator('.comment-composer').getByLabel('Reply').fill('Looks fine to me.');
    await thread.locator('.comment-composer').getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(thread.locator('.comment-replies li')).toHaveCount(1);
    await expect(thread.locator('.comment-replies')).toContainText('Looks fine to me.');

    await switchUser(page, editorB);
    await openComments(page);
    await blockThread(page).getByRole('button', { name: 'Resolve' }).click();

    await expect(panel(page).locator('.comment-list[aria-label="Open threads"] .comment-thread')).toHaveCount(1);
    await expect(badge(page)).toHaveText('1');
    await expect(page.locator(`.comment-gutter[data-block="${blockId}"] .comment-marker`)).toHaveCount(0);

    await panel(page).getByRole('button', { name: 'Resolved' }).click();
    const resolved = panel(page).locator('.comment-list[aria-label="Resolved threads"] .comment-thread');
    await expect(resolved).toHaveCount(1);
    await resolved.getByRole('button', { name: 'Reopen' }).click();

    await expect(panel(page).locator('.comment-list[aria-label="Open threads"] .comment-thread')).toHaveCount(2);
    await expect(badge(page)).toHaveText('2');
    await expect(page.locator(`.comment-gutter[data-block="${blockId}"] .comment-marker`)).toBeVisible();
  });

  test('the author edits and deletes their own comment; a deleted root with a reply keeps the reply, in dark mode too', async ({
    page,
  }) => {
    await switchUser(page, editorB);
    await openComments(page);

    await pageThread(page).getByRole('button', { name: 'Edit' }).click();
    await pageThread(page).getByLabel('Edit comment').fill('Nice start on these notes - thanks!');
    await pageThread(page).getByRole('button', { name: 'Save' }).click();
    await expect(pageThread(page)).toContainText('Nice start on these notes - thanks!');
    await expect(pageThread(page).locator('.comment-edited')).toBeVisible();

    const thread = blockThread(page);
    await thread.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(thread.getByRole('group', { name: 'Delete this comment?' })).toBeVisible();
    await thread.getByRole('group', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete' }).click();

    await expect(thread.locator('.comment-deleted')).toHaveText('Comment deleted');
    await expect(thread.locator('.comment-replies')).toContainText('Looks fine to me.');

    await page.screenshot({ path: 'test-results/comments-light.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(thread.locator('.comment-deleted')).toHaveText('Comment deleted');
    await page.screenshot({ path: 'test-results/comments-dark.png', fullPage: true });
  });
});
