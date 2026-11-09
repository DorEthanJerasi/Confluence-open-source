// AI browser tests (docs/done-checks/04-ai.md), part 3 (see ai.spec.ts),
// against the stub provider: a viewer who is not a member of a restricted
// space asks about a word only in that space and gets the fixed "couldn't
// find" answer with no sources; with AI off (via page.route on
// /api/ai/status), there is no Summarise button and no Ask entry in the top
// bar, and /ask shows the not-set-up note. The admin and the open space with
// its "Garden notes" page (what ai-ask.spec.ts makes on screen) come through the API
// helpers; the restricted page is still written on screen.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, pickBlankPage, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const outsider = { name: 'Otto Outsider', email: 'otto@stillwater.test', password: 'battery horse correct' };
const WORD = 'glimmerfinch';

const body = (page: Page) => page.locator('.page-editor .ProseMirror');
const askField = (page: Page) => page.getByLabel('Your question');
const answer = (page: Page) => page.getByRole('region', { name: 'Answer' });

async function newPage(page: Page, title: string, text: string) {
  await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('button', { name: 'New page' }).click();
  await pickBlankPage(page);
  await expect(page).toHaveURL(/\/p\/.+/);
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('Page title').blur();
  await body(page).click();
  await page.keyboard.type(text);
  await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
  return page.url();
}

async function ask(page: Page, q: string) {
  await page.getByRole('link', { name: 'Ask' }).click();
  await expect(page).toHaveURL('/ask');
  await askField(page).fill(q);
  await page.keyboard.press('Enter');
}

test.describe.serial('ask your docs: who can see what', () => {
  test.beforeAll(resetDatabase);

  test('a viewer who is not a member of a restricted space gets the "couldn\'t find" answer, with no sources', async ({
    page,
  }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Open Room', key: 'open-room', defaultRole: 'editor' });
    await createPage(page, 'open-room', { title: 'Garden notes', text: `A ${WORD} visited the feeder at dawn.` });
    await page.goto('/');

    await page.getByRole('button', { name: 'New space' }).click();
    await page.getByLabel('Name').fill('Quiet Room');
    await page.getByLabel('Who can see it').selectOption('restricted');
    await page.getByRole('button', { name: 'Create space' }).click();
    await expect(page).toHaveURL('/s/quiet-room');
    await newPage(page, 'Private notes', 'The hushwarbler nests only here.');

    await addPerson(page, outsider, 'viewer');

    await page.context().clearCookies();
    await logIn(page, outsider);
    await ask(page, 'What nests in the hushwarbler room?');

    await expect(page.getByText("I couldn't find anything about that in the pages you can see.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.ask-sources')).toHaveCount(0);
    await expect(page.locator('.ask-cite')).toHaveCount(0);
  });

  test('with AI off, Summarise and the Ask entry are both hidden, and /ask shows the not-set-up note', async ({ page }) => {
    await page.route('**/api/ai/status', (r) => r.fulfill({ json: { enabled: false } }));

    await logIn(page, admin, '/s/open-room');
    await page.getByRole('complementary', { name: 'Pages in this space' }).getByRole('link', { name: 'Garden notes' }).click();
    await expect(page.getByRole('button', { name: 'Summarise' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask' })).toHaveCount(0);

    await page.goto('/ask');
    await expect(page.getByText('AI is not set up on this wiki')).toBeVisible();
    await expect(askField(page)).toHaveCount(0);
  });
});
