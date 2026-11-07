// Setup shortcuts for tests whose subject is not the login form or the
// "Add a person" dialog. logIn posts to the same /api/auth/login the form
// uses, and addPerson to the same /api/users the dialog uses; page.request
// shares the browser context's cookies, so the session lands in the browser.
// That skips loading pages and typing into forms in every test, which was
// most of a test's setup. wiki.spec.ts still logs in and adds a person
// through the real forms, and the log-out test in permissions.spec.ts logs in
// through the form (logInWithForm), so both forms stay covered.
import { expect, type Page } from './fixtures';

type Login = { email: string; password: string };

/**
 * Logs in through the API, then opens `to` (home by default). Pass the page
 * the test is about to open anyway, so the app starts once instead of twice
 * (home, then that page): on this busy box each start of the app costs a
 * second or more. Pass null to stay put, e.g. when the next step is
 * addPerson, which only needs the session cookie.
 */
export async function logIn(page: Page, user: Login, to: string | null = '/'): Promise<void> {
  const res = await page.request.post('/api/auth/login', { data: { email: user.email, password: user.password } });
  expect(res.ok(), `log in as ${user.email}: HTTP ${res.status()}`).toBe(true);
  if (to === null) return;
  await page.goto(to);
  if (to === '/') await expect(page).toHaveURL('/');
}

export async function logInWithForm(page: Page, user: Login): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: false }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

type Person = Login & { name: string };

/** Adds an account the way an admin's "Add a person" dialog does. The page must be logged in as an admin. */
export async function addPerson(page: Page, user: Person, role: 'admin' | 'editor' | 'viewer'): Promise<void> {
  const res = await page.request.post('/api/users', {
    data: { name: user.name, email: user.email, password: user.password, role },
  });
  expect(res.status(), `add ${user.email} as ${role}`).toBe(201);
}

/**
 * Signs up through the same /api/auth/signup the sign-up form uses; the
 * first account on a fresh database becomes the instance admin, and the
 * session cookie lands in the browser. wiki.spec.ts still signs up through
 * the form.
 */
export async function signUp(page: Page, user: Person): Promise<void> {
  const res = await page.request.post('/api/auth/signup', {
    data: { name: user.name, email: user.email, password: user.password },
  });
  expect(res.status(), `sign up ${user.email}`).toBe(201);
}

type NewSpace = {
  name: string;
  key: string;
  visibility?: 'open' | 'restricted';
  defaultRole?: 'admin' | 'editor' | 'viewer';
};

/** Creates a space the way the "New space" dialog does (same /api/spaces call). The page must be logged in as an editor or admin. */
export async function createSpace(page: Page, space: NewSpace): Promise<void> {
  const res = await page.request.post('/api/spaces', {
    data: { name: space.name, key: space.key, visibility: space.visibility ?? 'open', defaultRole: space.defaultRole ?? 'viewer' },
  });
  expect(res.status(), `create space ${space.key}`).toBe(201);
}

/**
 * Creates a page in a space through /api/spaces/:key/pages, the call behind
 * the "New page" and "Sub-page" buttons, with its title and, if given, one
 * paragraph of text already in it (one version, like a page typed and saved
 * by its author). Returns the page's id and its URL path.
 */
export async function createPage(
  page: Page,
  spaceKey: string,
  init: { title: string; text?: string; parentId?: string },
): Promise<{ id: string; path: string }> {
  const doc = {
    type: 'doc',
    content: init.text ? [{ type: 'paragraph', content: [{ type: 'text', text: init.text }] }] : [],
  };
  const res = await page.request.post(`/api/spaces/${spaceKey}/pages`, {
    data: { title: init.title, parentId: init.parentId ?? null, doc },
  });
  expect(res.status(), `create page "${init.title}" in ${spaceKey}`).toBe(201);
  const { page: created } = (await res.json()) as { page: { id: string } };
  return { id: created.id, path: `/s/${spaceKey}/p/${created.id}` };
}
