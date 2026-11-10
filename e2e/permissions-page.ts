// Shared by permissions.spec.ts (lean suite rows 6-7): the people, the two
// spaces, the parent page and its sub-page, and the locators.
//
// Ada (admin) has a members-only space A with Eve as its editor, and an open
// space B. Otto is a plain editor outside A.
import { expect, type Page } from './fixtures';

export const ada = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
export const eve = { name: 'Eve Member', email: 'eve@stillwater.test', password: 'member horse battery' };
export const otto = { name: 'Otto Outsider', email: 'otto@stillwater.test', password: 'battery horse correct' };

export const A = { name: 'Harbour Plans', key: 'harbour-plans' };
export const B = { name: 'Open Field', key: 'open-field' };
export const PARENT = 'Mooring layout';
export const CHILD = 'Buoy colours';

export const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Pages in this space' });

/** The calm "Nothing here" screen, and none of A's content. */
export async function expectRefused(page: Page) {
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  await expect(page.getByText('does not exist, or you do not have access to it')).toBeVisible();
  await expect(page.getByText(PARENT)).toHaveCount(0);
  await expect(page.getByText(CHILD)).toHaveCount(0);
  await expect(page.locator('.page-editor')).toHaveCount(0);
}
