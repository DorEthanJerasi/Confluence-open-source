// Stage 07 page comments on screen (docs/done-checks/07-comments.md, 7b
// Playwright boxes), part 1 of 3: an editor comments on a block and on the
// page through the panel, and the marker and count survive a reload.
// Part 2 (viewer replies, editor resolves) is comments-roles.spec.ts and
// part 3 (author edits and deletes) is comments-author.spec.ts; each part
// builds its own starting point through the API helpers (comments-page.ts),
// so the three can run on different workers at once.
import { test, expect } from '../fixtures';
import { badge, editorB, openComments, panel, setUpSharedNotes, switchUser } from '../comments-page';
import { resetDatabase } from '../reset-db';

test.describe.serial('page comments: adding', () => {
  test.beforeAll(resetDatabase);

  test('an editor comments on the second paragraph and on the page; the marker and count survive a reload', async ({
    page,
  }) => {
    const { path } = await setUpSharedNotes(page);

    await switchUser(page, editorB, path);
    const secondPara = page.locator('.page-editor .ProseMirror > p', { hasText: 'Second paragraph' });
    const blockId = (await secondPara.getAttribute('data-block-id')) ?? '';
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
});
