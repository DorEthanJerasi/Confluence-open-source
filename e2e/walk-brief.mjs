// Final walk of the owner's brief (item #153), in a real browser, against a
// running Stillwater started fresh with install.sh (AI_PROVIDER=stub).
// Not part of npm run test:e2e: run it by hand, then look at the screenshots.
//
//   PLAYWRIGHT_BROWSERS_PATH=0 node e2e/walk-brief.mjs http://127.0.0.1:4317 docs/final-walk
//
// Every step logs PASS or FAIL and the walk carries on, so one run shows the
// whole brief. Results go to <out>/results.json, screenshots to <out>/shots/.
// The machine has no internet: YouTube/Vimeo players are blocked and the
// rich link card uses a browser-side reply for /api/link-preview, exactly
// like e2e/tests/video-links.spec.ts; the refused (plain) card is real.
import { chromium } from 'playwright';
import { expect as baseExpect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// This box is busy; give each check up to 15 s, like a patient person would.
const expect = baseExpect.configure({ timeout: 15_000 });

const base = process.argv[2] || 'http://127.0.0.1:4317';
const out = process.argv[3] || 'docs/final-walk';
const shots = join(out, 'shots');
mkdirSync(shots, { recursive: true });

const ada = { name: 'Ada Admin', email: 'ada@harbour.test', password: 'correct horse battery' };
const eve = { name: 'Eve Editor', email: 'eve@harbour.test', password: 'battery horse correct' };
const vera = { name: 'Vera Viewer', email: 'vera@harbour.test', password: 'staple battery horse' };
const sam = { name: 'Sam Signup', email: 'sam@harbour.test', password: 'horse staple correct' };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% lamp manual\n'.repeat(60));
const WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIIEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggE0TbuMU6uEHFO7a1OsggHy7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjMuMTEuMTAwV0GNTGF2ZjYzLjExLjEwMESJiEBpAAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYhMFQ2eHZhwSpyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBELqBEJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn+3NzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjMuMTEuMTAwc3PVY8CLY8WITBUNnh2YcEpnyKBFo4dFTkNPREVSRIeTTGF2YzYzLjIuMTAwIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMjAwMDAwMDAwAB9DtnW554EAo7SBAACAMAIAnQEqEAAQAABHCIWFiIWEiAICAnT0b0+A/vnnAKvV5lX/1lf//Mr//5lf7uwAHFO7a5G7j7OBALeK94EB8YIBtPCBAw==', 'base64');

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ step: name, ok: false, ms: Date.now() - t0, error: String(e.message || e).split('\n').slice(0, 6).join('\n') });
    console.log(`FAIL  ${name}\n      ${String(e.message || e).split('\n').slice(0, 4).join('\n      ')}`);
    for (const p of pages) await p.screenshot({ path: join(shots, `FAIL-${slug(name)}-${pages.indexOf(p)}.png`) }).catch(() => {});
  }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
const shot = (page, name) => page.screenshot({ path: join(shots, name + '.png'), fullPage: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const pages = [];
async function person() {
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1360, height: 900 } });
  await ctx.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  pages.push(page);
  return page;
}
const body = (p) => p.locator('.page-editor .ProseMirror');
const sidebar = (p) => p.getByRole('complementary', { name: 'Pages in this space' });
const saved = (p) => expect(p.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 15_000 });
async function setTheme(p, theme) {
  const btn = p.getByRole('button', { name: `Switch to ${theme} mode` });
  if (await btn.count()) await btn.click();
  await p.waitForTimeout(500);
}
async function logIn(p, u) {
  await p.goto('/login');
  await p.getByLabel('Email').fill(u.email);
  await p.getByLabel('Password', { exact: false }).fill(u.password);
  await p.getByRole('button', { name: 'Log in' }).click();
  await expect(p).toHaveURL(base + '/');
}
async function newPage(p, title, subOf = false) {
  const before = p.url();
  if (subOf) await p.getByRole('button', { name: 'Sub-page', exact: true }).click();
  else await sidebar(p).getByRole('button', { name: 'New page' }).click();
  const picker = p.getByRole('dialog', { name: 'New page' });
  await picker.getByRole('button', { name: 'Create page' }).click();
  // Wait until the new page has really opened (the URL changes and its title is empty).
  await expect.poll(() => p.url()).not.toBe(before);
  await expect(p).toHaveURL(/\/p\//);
  await expect(p.getByLabel('Page title')).toHaveValue('');
  await p.getByLabel('Page title').fill(title);
  await p.getByLabel('Page title').blur();
  await saved(p);
  return p.url();
}
async function slash(p, query, pick) {
  await p.keyboard.type('/' + query);
  const menu = p.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeVisible();
  return menu.getByRole('option', { name: new RegExp('^' + pick) }).first();
}
async function endLine(p) {
  await body(p).press('Control+End');
  await p.keyboard.press('Enter');
}
async function paste(p, text) {
  await body(p).evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

const A = await person(); // Ada, admin
const E = await person(); // Eve, editor
const V = await person(); // Vera, viewer
const S = await person(); // Sam, signs himself up, outside the members-only space
let parentUrl = '', childUrl = '', grandUrl = '', richUrl = '';

// 1. Sign-up, roles --------------------------------------------------------
await step('1a first sign-up through the form becomes admin', async () => {
  await A.goto('/signup');
  await shot(A, '01-signup-light');
  await A.getByLabel('Name').fill(ada.name);
  await A.getByLabel('Email').fill(ada.email);
  await A.getByLabel('Password', { exact: false }).fill(ada.password);
  await A.getByRole('button', { name: 'Create account' }).click();
  await expect(A).toHaveURL(base + '/');
  await A.goto('/admin/users');
  await expect(A.getByText(ada.email)).toBeVisible();
});
await step('1b admin adds an editor and a viewer in "Add a person"', async () => {
  for (const [u, role] of [[eve, 'editor'], [vera, 'viewer']]) {
    await A.getByRole('button', { name: 'Add a person' }).click();
    const d = A.getByRole('dialog', { name: 'Add a person' });
    await d.getByLabel('Name').fill(u.name);
    await d.getByLabel('Email').fill(u.email);
    await d.getByLabel('Starting password').fill(u.password);
    await d.getByLabel('Role').selectOption(role);
    await d.getByRole('button', { name: 'Add person' }).click();
    await expect(A.getByText(u.email)).toBeVisible();
  }
});
await step('1c a second person signs up through the form and logs out and back in', async () => {
  await S.goto('/signup');
  await S.getByLabel('Name').fill(sam.name);
  await S.getByLabel('Email').fill(sam.email);
  await S.getByLabel('Password', { exact: false }).fill(sam.password);
  await S.getByRole('button', { name: 'Create account' }).click();
  await expect(S).toHaveURL(base + '/');
  await S.getByRole('button', { name: 'Log out' }).click();
  await expect(S).toHaveURL(base + '/login');
  await logIn(S, sam);
  await expect(S.locator('.who-name')).toHaveText(sam.name);
});
await step('1d the people list shows all four with their roles', async () => {
  await A.reload();
  for (const u of [ada, eve, vera, sam]) await expect(A.getByText(u.email)).toBeVisible();
  await shot(A, '01-admin-people');
});
await step('1e Eve and Vera log in with the passwords the admin set', async () => {
  await logIn(E, eve);
  await logIn(V, vera);
});

// 2. Spaces, per-space permissions, nested pages ---------------------------
await step('2a admin makes an open space and a members-only space in the dialog', async () => {
  for (const [name, vis] of [['Harbour', 'open'], ['Lighthouse', 'restricted']]) {
    await A.goto('/');
    await A.getByRole('button', { name: 'New space' }).click();
    await A.getByLabel('Name').fill(name);
    await A.getByLabel('Who can see it').selectOption(vis);
    await A.getByRole('button', { name: 'Create space' }).click();
    await expect(A).toHaveURL(base + '/s/' + name.toLowerCase());
    await shot(A, '02-space-' + name.toLowerCase());
  }
  await expect(sidebar(A).getByLabel('Members only')).toBeVisible();
});
await step('2b space settings: Eve joins Lighthouse as editor, Vera as viewer', async () => {
  await A.goto('/s/lighthouse/settings');
  for (const [u, role] of [[eve, 'editor'], [vera, 'viewer']]) {
    await A.getByLabel('Person to add').selectOption({ label: `${u.name} (${u.email})` });
    await A.getByLabel('Role for new member').selectOption(role);
    await A.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(A.locator('.member-list')).toContainText(u.name);
  }
  await shot(A, '02-space-settings');
});
await step('2c nested pages: parent, sub-page, sub-sub-page in the tree and breadcrumb', async () => {
  await A.goto('/s/lighthouse');
  parentUrl = await newPage(A, 'Lamp manual');
  await body(A).click();
  await A.keyboard.insertText('How we keep the beacon lit through the night.');
  await saved(A);
  childUrl = await newPage(A, 'Night checks', true);
  grandUrl = await newPage(A, 'Winter routine', true);
  await expect(A.locator('.crumb').getByRole('link', { name: 'Night checks', exact: true })).toBeVisible();
  await expect(A.locator('.crumb').getByRole('link', { name: 'Lamp manual', exact: true })).toBeVisible();
  const parentRow = sidebar(A).locator('li', { has: A.getByRole('link', { name: 'Lamp manual', exact: true }) }).first();
  await expect(parentRow.locator('.tree-children').getByRole('link', { name: 'Winter routine', exact: true })).toBeVisible();
  await shot(A, '02-nested-pages');
});
await step('2d Sam (editor, not a member) cannot see Lighthouse in the list or by URL', async () => {
  await S.goto('/');
  await expect(S.locator('.cards').getByRole('link', { name: /Harbour/ })).toBeVisible();
  await expect(S.getByText('Lighthouse')).toHaveCount(0);
  for (const url of ['/s/lighthouse', parentUrl.replace(base, ''), grandUrl.replace(base, '')]) {
    await S.goto(url);
    await expect(S.getByLabel('Page title')).toHaveCount(0);
    await expect(S.getByText(/beacon/)).toHaveCount(0);
  }
  await shot(S, '02-outsider-refused');
});
await step('2e Vera (viewer member) reads Lighthouse but cannot edit or add pages', async () => {
  await V.goto(parentUrl);
  await expect(body(V)).toContainText('beacon');
  await expect(body(V)).toHaveAttribute('contenteditable', 'false');
  await expect(sidebar(V).getByRole('button', { name: 'New page' })).toHaveCount(0);
  await shot(V, '02-viewer-readonly');
});

// 3. Block editor, slash commands, every embed ------------------------------
await step('3a slash commands: heading, list, task list, quote, code, divider', async () => {
  await E.goto(childUrl);
  await body(E).click();
  await E.keyboard.insertText('Walk the gallery at dusk.');
  await E.keyboard.press('Enter');
  await (await slash(E, 'head', 'Heading')).click();
  await E.keyboard.type('Checklist');
  await E.keyboard.press('Enter');
  await (await slash(E, 'bull', 'Bullet')).click();
  await E.keyboard.type('Clean the lens');
  await E.keyboard.press('Enter');
  await E.keyboard.press('Enter');
  await (await slash(E, 'task', 'Task')).click();
  await E.keyboard.type('Check the fuel');
  await E.keyboard.press('Enter');
  await E.keyboard.press('Enter');
  await (await slash(E, 'quote', 'Quote')).click();
  await E.keyboard.type('Keep the light steady.');
  await E.keyboard.press('Enter');
  await E.keyboard.press('Enter');
  await (await slash(E, 'code', 'Code')).click();
  await E.keyboard.type('const lit = true');
  await body(E).press('Control+End');
  await E.keyboard.press('ArrowDown');
  await endLine(E);
  await (await slash(E, 'divid', 'Divider')).click();
  await expect(body(E).locator('h2, h1, h3').filter({ hasText: 'Checklist' })).toHaveCount(1);
  await expect(body(E).locator('ul li').filter({ hasText: 'Clean the lens' })).toHaveCount(1);
  await expect(body(E).locator('li[data-type="taskItem"]')).toHaveCount(1);
  await expect(body(E).locator('blockquote')).toContainText('Keep the light steady.');
  await expect(body(E).locator('pre')).toContainText('const lit = true');
  await expect(body(E).locator('hr')).toHaveCount(1);
  await saved(E);
});
await step('3b embeds: image upload with caption, file upload with download', async () => {
  await endLine(E);
  let chooser = E.waitForEvent('filechooser');
  await (await slash(E, 'imag', 'Image')).click();
  await (await chooser).setFiles({ name: 'beacon.png', mimeType: 'image/png', buffer: PNG });
  await expect(body(E).locator('figure.embed-image img')).toHaveCount(1);
  await expect.poll(() => body(E).locator('figure.embed-image img').evaluate((i) => i.naturalWidth)).toBe(1);
  await E.getByLabel('Image caption').first().fill('The beacon at dusk');
  await endLine(E);
  chooser = E.waitForEvent('filechooser');
  await (await slash(E, 'file', 'File')).click();
  await (await chooser).setFiles({ name: 'lamp-manual.pdf', mimeType: 'application/pdf', buffer: PDF });
  const link = body(E).locator('.embed-file').getByRole('link', { name: 'Download lamp-manual.pdf' });
  await expect(link).toBeVisible();
  const res = await E.request.get(await link.getAttribute('href'));
  expect(res.status()).toBe(200);
  expect((await res.body()).equals(PDF)).toBe(true);
  await saved(E);
});
await step('3c embeds: uploaded video plays; YouTube and Vimeo links become players', async () => {
  await endLine(E);
  const chooser = E.waitForEvent('filechooser');
  await (await slash(E, 'vid', 'Video')).click();
  await (await chooser).setFiles({ name: 'sea.webm', mimeType: 'video/webm', buffer: WEBM });
  await expect(body(E).locator('.embed-video video')).toHaveCount(1);
  await endLine(E);
  await paste(E, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(body(E).locator('iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1);
  await endLine(E);
  await paste(E, 'https://vimeo.com/76979871');
  await expect(body(E).locator('iframe[src^="https://player.vimeo.com/video/76979871"]')).toHaveCount(1);
  await saved(E);
});
await step('3d embeds: link preview cards (rich from a canned reply, refused fetch gives a plain card); table', async () => {
  await E.route('**/api/link-preview**', (r) =>
    r.fulfill({ json: { url: 'https://almanac.example/tides', title: 'Harbour Almanac', description: 'Tide tables for the coast.', siteName: 'almanac.example', image: null } }),
  );
  await endLine(E);
  await paste(E, 'https://almanac.example/tides');
  await E.getByRole('button', { name: 'Show as preview card' }).click();
  await expect(body(E).locator('.embed-link:not(.is-plain)')).toContainText('Harbour Almanac');
  await E.unroute('**/api/link-preview**');
  await endLine(E);
  await paste(E, 'http://127.0.0.1:9/private');
  await E.getByRole('button', { name: 'Show as preview card' }).click();
  await expect(body(E).locator('.embed-link.is-plain')).toHaveCount(1);
  // Table last, so the blocks above do not land inside its cells.
  await endLine(E);
  await (await slash(E, 'table', 'Table')).click();
  await E.keyboard.type('Lamp');
  await expect(body(E).locator('table')).toContainText('Lamp');
  await saved(E);
  await E.reload();
  await expect(body(E).locator('.embed-link')).toHaveCount(2);
  await expect(body(E).locator('figure.embed-image img')).toHaveCount(1);
  await expect(body(E).locator('.embed-video')).toHaveCount(3);
  await expect(body(E).locator('table')).toHaveCount(1);
  await setTheme(E, 'light');
  await shot(E, '03-every-block-light');
  await setTheme(E, 'dark');
  await shot(E, '03-every-block-dark');
  await setTheme(E, 'light');
});

// 4. Search -------------------------------------------------------------------
async function search(p, q) {
  await p.goto('/search?q=' + encodeURIComponent(q));
  await expect(p.getByRole('searchbox', { name: 'Search pages' })).toHaveValue(q);
  await p.waitForTimeout(1200);
  return p.getByRole('list', { name: 'Search results' });
}
const result = (list, title) => list.locator('.result').filter({ has: list.page().locator('.result-title', { hasText: new RegExp('^' + title + '$') }) });
await step('4a search: members find Lighthouse pages; the outsider does not', async () => {
  let list = await search(E, 'beacon');
  await expect(result(list, 'Lamp manual')).toBeVisible();
  await expect(list.locator('mark').first()).toBeVisible();
  await shot(E, '04-search-member');
  list = await search(V, 'gallery');
  await expect(result(list, 'Night checks')).toBeVisible();
  list = await search(S, 'beacon');
  await expect(S.getByText('Lamp manual')).toHaveCount(0);
  await expect(S.getByText('Night checks')).toHaveCount(0);
  await shot(S, '04-search-outsider');
});

// 5. History restore -----------------------------------------------------------
await step('5 history: Eve changes the page, Ada opens the earlier version and restores it', async () => {
  // A person's own quick saves fold into one version; a different person's edit starts a new one.
  await E.goto(parentUrl);
  await body(E).locator('p').first().click();
  await E.keyboard.press('End');
  await E.keyboard.press('Shift+Home');
  await E.keyboard.insertText('This text replaced the first version.');
  await saved(E);
  await A.goto(parentUrl);
  await expect(body(A)).toContainText('replaced the first version');
  await A.getByRole('button', { name: 'History' }).click();
  const panel = A.getByRole('complementary', { name: 'Page history' });
  await expect(panel).toBeVisible();
  const rows = panel.locator('.version-row');
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  await rows.last().click();
  await expect(A.locator('.version-preview')).toContainText('beacon');
  await shot(A, '05-history-preview');
  await A.getByRole('button', { name: 'Restore this version' }).click();
  await A.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(body(A)).toContainText('How we keep the beacon lit through the night.');
  await expect(body(A)).not.toContainText('replaced the first version');
  await A.reload();
  await expect(body(A)).toContainText('beacon lit');
  await shot(A, '05-history-restored');
});

// 6. AI on the stub -------------------------------------------------------------
await step('6a AI summary of a page', async () => {
  await A.goto(parentUrl);
  await A.getByRole('button', { name: 'Summarise' }).click();
  const card = A.getByRole('region', { name: 'Page summary' });
  await expect(card.locator('.summary-text')).toContainText('beacon', { timeout: 15_000 });
  await shot(A, '06-summary');
});
await step('6b Ask: answer with sources that link back to the page', async () => {
  await E.goto('/');
  await E.getByRole('link', { name: 'Ask', exact: true }).click();
  await E.getByLabel('Your question').fill('How do we keep the beacon lit?');
  await E.keyboard.press('Enter');
  const answer = E.getByRole('region', { name: 'Answer' });
  await expect(answer).toBeVisible({ timeout: 15_000 });
  await expect(answer.locator('.ask-cite').first()).toBeVisible();
  await expect(E.locator('.ask-sources').getByRole('link', { name: /Lamp manual/ })).toBeVisible();
  await shot(E, '06-ask-sources');
  await E.locator('.ask-sources').getByRole('link', { name: /Lamp manual/ }).click();
  await expect(E).toHaveURL(parentUrl);
});
await step('6c Ask as the outsider never cites the members-only page', async () => {
  await S.goto('/ask');
  await S.getByLabel('Your question').fill('How do we keep the beacon lit?');
  await S.keyboard.press('Enter');
  await S.waitForTimeout(3000);
  await expect(S.getByRole('link', { name: /Lamp manual/ })).toHaveCount(0);
  await shot(S, '06-ask-outsider');
});

// 7. Trash ------------------------------------------------------------------
await step('7 trash: delete a sub-page, gone from tree and search, viewer cannot restore, editor restores', async () => {
  await E.goto(grandUrl);
  const row = sidebar(E).locator('.tree-row', { has: E.getByRole('link', { name: 'Winter routine', exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: 'More actions' }).click();
  await E.getByRole('menuitem', { name: 'Delete' }).click();
  await E.getByRole('dialog', { name: /Move “Winter routine” to the trash\?/ }).getByRole('button', { name: 'Move to trash' }).click();
  await E.goto('/s/lighthouse');
  await expect(sidebar(E).getByRole('link', { name: 'Winter routine', exact: true })).toHaveCount(0);
  await search(E, 'Winter routine');
  await expect(E.getByRole('link', { name: /Winter routine/ })).toHaveCount(0);
  await V.goto('/s/lighthouse/trash');
  await expect(V.getByRole('button', { name: /Restore/ })).toHaveCount(0);
  await shot(V, '07-trash-viewer');
  await E.goto('/s/lighthouse/trash');
  await shot(E, '07-trash');
  await E.getByRole('button', { name: 'Restore “Winter routine”' }).click();
  await expect(E.getByRole('status').filter({ hasText: 'is back in the page tree' })).toBeVisible();
  await E.goto(grandUrl);
  await expect(E.getByLabel('Page title')).toHaveValue('Winter routine');
  await expect(E.locator('.crumb').getByRole('link', { name: 'Night checks', exact: true })).toBeVisible();
});

// 8. The extras built after the brief: comments, labels, favourites, templates, tasks
await step('8a comment on a page, read by a viewer', async () => {
  await E.goto(parentUrl);
  await E.getByRole('button', { name: 'Comments' }).click();
  await E.getByLabel('Comment on this page').fill('Checked the lamp tonight.');
  await E.locator('.comment-page-composer').getByRole('button', { name: 'Comment', exact: true }).click();
  await V.goto(parentUrl);
  await V.getByRole('button', { name: 'Comments' }).click();
  await expect(V.getByText('Checked the lamp tonight.')).toBeVisible();
  await shot(V, '08-comment-viewer');
});
await step('8b label a page and find it by the label', async () => {
  await E.goto(parentUrl);
  await E.getByRole('button', { name: 'Add label' }).click();
  await E.getByRole('combobox', { name: 'Add label' }).fill('night-watch');
  await E.keyboard.press('Enter');
  await expect(E.getByRole('list', { name: 'Labels' }).getByRole('link', { name: 'night-watch' })).toBeVisible();
  await search(E, 'label:night-watch');
  await expect(E.getByRole('link', { name: /Lamp manual/ })).toBeVisible();
});
await step('8c favourite a page; it shows on Home', async () => {
  await E.goto(parentUrl);
  await E.getByRole('button', { name: 'Add to favourites' }).click();
  await E.goto('/');
  await expect(E.getByRole('region', { name: 'Favourites', exact: true }).getByRole('link', { name: /Lamp manual/ })).toBeVisible();
  await shot(E, '08-home-favourites');
});
await step('8d My tasks lists the task from the page', async () => {
  await E.goto('/');
  await E.getByRole('link', { name: 'My tasks' }).click();
  await E.waitForTimeout(1000);
  await shot(E, '08-my-tasks');
});

// 9. Look: light and dark, reduced motion ------------------------------------
await step('9 dark mode and reduced motion across the main screens', async () => {
  await A.emulateMedia({ reducedMotion: 'reduce' });
  await A.goto('/');
  await setTheme(A, 'dark');
  await shot(A, '09-home-dark');
  await A.goto(childUrl);
  await shot(A, '09-page-dark');
  await A.goto('/s/lighthouse/settings');
  await shot(A, '09-settings-dark');
  await setTheme(A, 'light');
  await A.goto('/');
  await shot(A, '09-home-light');
});

await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify({ base, ran: new Date().toISOString(), results }, null, 2) + '\n');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
