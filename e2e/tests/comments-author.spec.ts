// Stage 07 page comments on screen, part 3 of 3 (see comments.spec.ts): the
// author edits and deletes their own comment, and a deleted root with a
// reply keeps the reply, in light and dark. Starts from what parts 1 and 2
// leave behind (Beck's two comments, Cleo's reply), made through the API.
import { test, expect } from '../fixtures';
import { addBecksComments, blockThread, editorB, openComments, pageThread, setUpSharedNotes, switchUser } from '../comments-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('page comments: author', () => {
  test.beforeAll(resetDatabase);

  test('the author edits and deletes their own comment; a deleted root with a reply keeps the reply, in dark mode too', async ({
    page,
  }) => {
    const { id, path } = await setUpSharedNotes(page);
    await addBecksComments(page, id, true);

    await switchUser(page, editorB, path);
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
