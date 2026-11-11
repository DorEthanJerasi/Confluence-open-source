// Mentions on screen (docs/done-checks/15-mentions.md, 15b). One short test:
// an editor types @, picks a viewer and the page saves with the chip; the
// viewer, in a second browser, sees the bell count 1, opens the panel, reads
// "… mentioned you on …", clicks it and lands on the page with the count
// gone, then follows the page. File 18 of done-check 10's limit of 18.
// Everything else about mentions, following and notifications (who is told,
// folding edits, the read filter, paging, only your own) is proven by
// apps/server/test/notifications.test.ts. Set-up goes through e2e/login.ts.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const ed = { name: 'Ed Editor', email: 'ed@stillwater.test', password: 'battery horse correct' };
const vi = { name: 'Vi Viewer', email: 'vi@stillwater.test', password: 'horse battery correct' };

const body = (page: Page) => page.locator('.page-editor .ProseMirror');

test.describe.serial('mentions and the bell', () => {
  test.beforeAll(resetDatabase);

  test('an editor mentions a viewer; the viewer sees the bell, opens it, lands on the page and follows it', async ({
    page,
    browser,
  }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Orchard', key: 'orchard', defaultRole: 'editor' });
    await addPerson(page, ed, 'editor');
    await addPerson(page, vi, 'viewer');
    const guide = await createPage(page, 'orchard', { title: 'Pruning guide', text: 'Cut in late winter.' });

    // The viewer's browser opens the app (bell at 0) while the editor's opens the page.
    const ctx = await browser.newContext();
    const v = await ctx.newPage();
    await page.context().clearCookies();
    await Promise.all([logIn(page, ed, guide.path), logIn(v, vi, '/')]);
    await expect(v.getByRole('button', { name: 'Notifications, none unread' })).toBeVisible();

    // The editor types @, narrows to Vi and picks with Enter: a chip, then a save
    // (leaving the editor saves at once instead of after the autosave pause).
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' Ask ');
    await page.keyboard.type('@vi');
    const list = page.getByRole('listbox', { name: 'Mention someone' });
    await expect(list.getByRole('option')).toHaveText(['Vi Viewer']);
    await page.keyboard.press('Enter');
    await expect(body(page).locator('.mention')).toHaveText(/Vi Viewer/);
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/pages/${guide.id}`) && r.request().method() === 'PUT');
    await body(page).blur();
    expect((await saved).status()).toBe(200);

    // The viewer comes back to the tab: the bell asks again on window focus
    // (no reload), says 1, and the panel says who and where.
    await v.evaluate(() => window.dispatchEvent(new Event('focus')));
    const bell = v.getByRole('button', { name: '1 unread notification' });
    await expect(bell).toHaveText('1');
    await bell.click();
    const panel = v.getByRole('dialog', { name: 'Notifications' });
    const item = panel.getByRole('link', { name: /Ed Editor mentioned you on Pruning guide/ });
    await item.click();
    await expect(v).toHaveURL(guide.path);
    await expect(v.getByRole('button', { name: 'Notifications, none unread' })).toHaveText('');

    // Viewers can follow too.
    await v.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(v.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
    await ctx.close();
  });
});
