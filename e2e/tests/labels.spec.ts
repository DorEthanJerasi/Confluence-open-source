// Labels on screen (docs/done-checks/13-labels.md, 13b): one short test. An
// editor adds a label with the Add label control and sees its chip, opens
// the chip's space view, then "In all spaces", then the search screen with
// `label:`. Everything else about labels (names, roles, the 403 for viewers,
// restricted spaces, trash, limits) is proven by apps/server/test/labels.test.ts.
// Set-up goes through the API helpers in e2e/login.ts.
import { test, expect } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const editor = { name: 'Beck Editor', email: 'beck@stillwater.test', password: 'battery horse correct' };

test.describe.serial('labels', () => {
  test.beforeAll(resetDatabase);

  test('an editor adds a label and finds the page through its chip, the space and wiki views, and search', async ({ page }) => {
    // Set-up through the API, the independent calls side by side.
    await signUp(page, admin);
    await Promise.all([
      createSpace(page, { name: 'Harbour', key: 'harbour', defaultRole: 'editor' }),
      createSpace(page, { name: 'Lighthouse', key: 'lighthouse', defaultRole: 'editor' }),
      addPerson(page, editor, 'editor'),
    ]);
    const [typed, second, elsewhere] = await Promise.all([
      createPage(page, 'harbour', { title: 'Tide tables' }),
      createPage(page, 'harbour', { title: 'Mooring list' }),
      createPage(page, 'lighthouse', { title: 'Lamp checks' }),
    ]);
    await Promise.all(
      [second.id, elsewhere.id].map(async (id) => {
        const res = await page.request.post(`/api/pages/${id}/labels`, { data: { name: 'night-watch' } });
        expect(res.status()).toBe(200);
      }),
    );
    await page.context().clearCookies();

    // The Add label control: the name shows in its stored form while typing; Enter adds it.
    await logIn(page, editor, typed.path);
    await page.getByRole('button', { name: 'Add label' }).click();
    const input = page.getByRole('combobox', { name: 'Add label' });
    await input.fill('Night Watch');
    await expect(page.getByText('Adds as “night-watch”')).toBeVisible();
    const added = page.waitForResponse((r) => r.url().endsWith(`/api/pages/${typed.id}/labels`) && r.request().method() === 'POST');
    await input.press('Enter');
    expect((await added).status()).toBe(200);
    const chip = page.getByRole('list', { name: 'Labels' }).getByRole('link', { name: 'night-watch' });
    await expect(chip).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove label night-watch' })).toBeVisible();

    // The chip opens this space's view: both labelled pages here, not the one in Lighthouse.
    await chip.click();
    await expect(page).toHaveURL('/s/harbour/labels/night-watch');
    const list = page.getByRole('list', { name: 'Pages with the label night-watch' });
    await expect(list.getByRole('link')).toHaveCount(2);
    await expect(list.getByRole('link', { name: /Tide tables/ })).toBeVisible();
    await expect(list.getByRole('link', { name: /Mooring list/ })).toBeVisible();

    // "In all spaces" adds the page from the second space, with its space name.
    await page.getByRole('link', { name: 'In all spaces' }).click();
    await expect(page).toHaveURL('/labels/night-watch');
    await expect(list.getByRole('link')).toHaveCount(3);
    await expect(list.getByRole('link', { name: /Lamp checks/ })).toContainText('Lighthouse');

    // The search box takes label:name; the filter shows as a chip and the results carry the label.
    const field = page.getByRole('searchbox', { name: 'Search pages' });
    await field.fill('label:night-watch tide');
    await field.press('Enter');
    await expect(page).toHaveURL(`/search?q=${encodeURIComponent('label:night-watch tide')}`);
    await expect(page.getByRole('list', { name: 'Label filter' })).toContainText('night-watch');
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('link')).toHaveCount(1);
    await expect(results.getByRole('link', { name: /Tide tables/ })).toBeVisible();
  });
});
