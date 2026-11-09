// Stage 07 page comments on screen, part 2 of 3 (see comments.spec.ts): a
// viewer can read and reply but not resolve or edit the editor's comments,
// and the editor resolves and reopens the thread. Starts from what part 1
// leaves behind (Beck's block and page comments), made through the API.
import { test, expect } from '../fixtures';
import {
  SECOND_BLOCK,
  addBecksComments,
  badge,
  blockThread,
  editorB,
  openComments,
  panel,
  setUpSharedNotes,
  switchUser,
  viewerC,
} from '../comments-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('page comments: roles', () => {
  test.beforeAll(resetDatabase);

  test('a viewer can read and reply but not resolve or edit the editor\'s comments; the editor resolves and reopens', async ({
    page,
  }) => {
    const { id, path } = await setUpSharedNotes(page);
    await addBecksComments(page, id);
    const blockId = SECOND_BLOCK;

    await switchUser(page, viewerC, path);
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

    await switchUser(page, editorB, path);
    await openComments(page);
    await expect(page.locator(`.comment-gutter[data-block="${blockId}"] .comment-marker`)).toBeVisible();
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
});
