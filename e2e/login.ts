// Setup shortcuts for tests whose subject is not the login form or the
// "Add a person" dialog. logIn posts to the same /api/auth/login the form
// uses, and addPerson to the same /api/users the dialog uses; page.request
// shares the browser context's cookies, so the session lands in the browser.
// That skips loading pages and typing into forms in every test, which was
// most of a test's setup. wiki.spec.ts still signs up, logs in and out and
// adds a person through the real forms, so those forms stay covered.
//
// Each person logs in once per spec file: the first logIn (or signUp) saves
// the browser's storageState, and every later logIn for that person, in any
// test of the file, puts that saved state into the new browser context
// instead of posting the password again (each login is an argon2 check, a
// real cost on this busy box). resetDatabase() empties the sessions table at
// the start of each file, so it also forgets the saved states (forgetSessions).
import { expect, type BrowserContext, type Page } from './fixtures';

type Login = { email: string; password: string };
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

// One map per test worker process; each worker has its own server and database.
const saved = new Map<string, StorageState>();

/** Drops every saved login. resetDatabase() calls this, since it deletes the sessions behind them. */
export function forgetSessions(): void {
  saved.clear();
}

/** Logs `user` in through the API in `context` and saves its storageState. */
async function logInOnce(context: BrowserContext, user: Login): Promise<StorageState> {
  const res = await context.request.post('/api/auth/login', { data: { email: user.email, password: user.password } });
  expect(res.ok(), `log in as ${user.email}: HTTP ${res.status()}`).toBe(true);
  return remember(context, user.email);
}

async function remember(context: BrowserContext, email: string): Promise<StorageState> {
  const state = await context.storageState();
  saved.set(email, state);
  return state;
}

/**
 * Logs in (the first time through the API, after that from the saved
 * storageState), then opens `to` (home by default). Pass the page
 * the test is about to open anyway, so the app starts once instead of twice
 * (home, then that page): on this busy box each start of the app costs a
 * second or more. Pass null to stay put, e.g. when the next step is
 * addPerson, which only needs the session cookie.
 */
export async function logIn(page: Page, user: Login, to: string | null = '/'): Promise<void> {
  if (saved.has(user.email)) {
    // Same as a fresh context made with this storageState: only these cookies.
    const context = page.context();
    await context.clearCookies();
    await context.addCookies(saved.get(user.email)!.cookies);
  } else {
    await logInOnce(page.context(), user);
  }
  if (to === null) return;
  await page.goto(to);
  if (to === '/') await expect(page).toHaveURL('/');
}

type Person = Login & { name: string };

/** Adds an account the way an admin's "Add a person" dialog does. The page must be logged in as an admin. Returns the new user's id. */
export async function addPerson(page: Page, user: Person, role: 'admin' | 'editor' | 'viewer'): Promise<string> {
  const res = await page.request.post('/api/users', {
    data: { name: user.name, email: user.email, password: user.password, role },
  });
  expect(res.status(), `add ${user.email} as ${role}`).toBe(201);
  const { user: created } = (await res.json()) as { user: { id: string } };
  return created.id;
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
  await remember(page.context(), user.email);
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
 * by its author). Returns the page's id and its URL path. Pass `doc` instead
 * of `text` for content a single paragraph can't hold (a heading, a table).
 */
export async function createPage(
  page: Page,
  spaceKey: string,
  init: { title: string; text?: string; doc?: object; parentId?: string },
): Promise<{ id: string; path: string; version: number }> {
  const doc = init.doc ?? {
    type: 'doc',
    content: init.text ? [{ type: 'paragraph', content: [{ type: 'text', text: init.text }] }] : [],
  };
  const res = await page.request.post(`/api/spaces/${spaceKey}/pages`, {
    data: { title: init.title, parentId: init.parentId ?? null, doc },
  });
  expect(res.status(), `create page "${init.title}" in ${spaceKey}`).toBe(201);
  const { page: created } = (await res.json()) as { page: { id: string; version: number } };
  return { id: created.id, path: `/s/${spaceKey}/p/${created.id}`, version: created.version };
}

/**
 * Every "New page" and "Sub-page" control opens the template picker first
 * (done-check 08). "Blank page" is chosen and focused when it opens; this
 * makes the blank page, as those buttons did before templates.
 */
export async function pickBlankPage(page: Page): Promise<void> {
  const picker = page.getByRole('dialog', { name: 'New page' });
  await expect(picker.getByRole('option', { name: /Blank page/ })).toBeFocused();
  await picker.getByRole('button', { name: 'Create page' }).click();
}
