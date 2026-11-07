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

export async function logIn(page: Page, user: Login): Promise<void> {
  const res = await page.request.post('/api/auth/login', { data: { email: user.email, password: user.password } });
  expect(res.ok(), `log in as ${user.email}: HTTP ${res.status()}`).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL('/');
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
