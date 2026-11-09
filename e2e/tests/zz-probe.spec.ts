import { test, expect } from '../fixtures';
import { createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';
const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
let url = '';
test.describe.serial('probe', () => {
  test.beforeAll(resetDatabase);
  for (let i = 0; i < 4; i++) test('probe ' + i, async ({ page }) => {
    const t: string[] = []; let t0 = Date.now(); const lap = (s: string) => { t.push(`${s} ${Date.now() - t0}`); t0 = Date.now(); };
    if (i === 0) { await signUp(page, admin); await createSpace(page, { name: 'Ocean', key: 'ocean' }); url = (await createPage(page, 'ocean', { title: 'Tides', text: 'hello' })).path; lap('api'); }
    else { await logIn(page, admin, null); lap('login'); }
    await page.goto('/'); await expect(page.getByRole('heading').first()).toBeVisible(); lap('home');
    await page.goto(url); await expect(page.locator('.page-editor .ProseMirror')).toContainText('hello'); lap('editor');
    await page.reload(); await expect(page.locator('.page-editor .ProseMirror')).toContainText('hello'); lap('reload');
    await page.locator('.page-editor .ProseMirror').click(); await page.keyboard.type('abcdefghij'); lap('type10');
    await expect(page.getByRole('status')).toHaveText('Saved'); lap('saved');
    await page.screenshot({ path: 'test-results/p.png', fullPage: true }); lap('shot');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await page.screenshot({ path: 'test-results/p2.png', fullPage: true }); lap('shot-dark');
    console.log(t.join(' | '));
  });
});
