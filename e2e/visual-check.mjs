import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

async function waitForPath(page, pattern, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const path = new URL(page.url()).pathname;
    if (pattern.test(path)) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`never reached ${pattern}, stuck at ${page.url()}`);
}

const browserPath = execSync('find / -maxdepth 8 -iname "chrome" -path "*chromium*" 2>/dev/null | head -1').toString().trim();
const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: browserPath || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const base = 'http://localhost:5174';

await page.goto(base + '/signup');
await page.getByLabel('Name').fill('Designer Check');
await page.getByLabel('Email').fill(`designer-${Date.now()}@stillwater.test`);
await page.getByLabel('Password', { exact: false }).fill('correct horse battery');
await page.getByRole('button', { name: 'Create account' }).click();
await waitForPath(page, /^\/$/);

await page.getByRole('button', { name: 'New space' }).click();
await page.getByLabel('Name').fill(`Design Review ${Date.now()}`);
await page.getByRole('button', { name: 'Create space' }).click();
await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
await waitForPath(page, /\/p\//);

await page.getByLabel('Page title').fill('Styling check');
await page.getByLabel('Page title').blur();

const body = page.locator('.page-editor .ProseMirror');
await body.click();
await page.keyboard.type('/head');
await page.keyboard.press('Enter');
await page.keyboard.type('A calm heading');
await page.keyboard.press('Enter');

await page.keyboard.type('/call');
const menu = page.getByRole('listbox', { name: 'Insert block' });
await menu.getByRole('option', { name: /^Callout/ }).click();
await page.keyboard.type('This is a callout note.');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');

await page.keyboard.type('/code');
await menu.getByRole('option', { name: /^Code block/ }).click();
await page.keyboard.type('const x = 1;');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');

await page.keyboard.type('/table');
await menu.getByRole('option', { name: /^Table/ }).click();
await page.keyboard.type('open the slash menu');
await page.keyboard.press('Escape');
await body.click();

await page.waitForTimeout(200);
await page.keyboard.type('/');
await page.waitForTimeout(150);
await page.screenshot({ path: '/tmp/01-slash-menu-light.png' });
await page.keyboard.press('Escape');

await expect_saved(page);
await page.screenshot({ path: '/tmp/02-editor-light.png', fullPage: true });

// dark mode
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/03-editor-dark.png', fullPage: true });

await body.click();
await page.keyboard.press('End');
await page.keyboard.type('/');
await page.waitForTimeout(150);
await page.screenshot({ path: '/tmp/04-slash-menu-dark.png' });

await browser.close();
console.log('DONE');

async function expect_saved(page) {
  for (let i = 0; i < 20; i++) {
    const text = await page.locator('[role="status"]').first().textContent().catch(() => '');
    if (text && text.includes('Saved')) return;
    await page.waitForTimeout(500);
  }
}
