// Task lists on screen (docs/done-checks/12-tasks.md, 12b). An editor gives a
// task to a second editor with a due date through the Assign and Due date
// controls; the chips show; the second editor ticks it in My tasks, it leaves
// the list with an Undo note, and the page shows it ticked (dark mode once).
// A viewer sees their overdue task with the box disabled; a person outside a
// restricted space sees none of the tasks there; trashing the page takes the
// viewer's task out of My tasks. Who may do what on the server is proven by
// apps/server/test/tasks.test.ts. Set-up goes through the API helpers in
// e2e/login.ts.
import { test, expect, type Page } from '../fixtures';
import { addPerson, createPage, createSpace, logIn, signUp } from '../login';
import { resetDatabase } from '../reset-db';

const admin = { name: 'Ada Admin', email: 'ada@stillwater.test', password: 'correct horse battery' };
const ed = { name: 'Ed Editor', email: 'ed@stillwater.test', password: 'battery horse correct' };
const eve = { name: 'Eve Editor', email: 'eve@stillwater.test', password: 'horse correct battery' };
const vera = { name: 'Vera Viewer', email: 'vera@stillwater.test', password: 'horse battery correct' };

/** The local date `offset` days from today, `YYYY-MM-DD` (the browser runs on this machine). */
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Task = { text: string; assignee?: string; due?: string };
const taskDoc = (tasks: Task[]) => ({
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: tasks.map((t) => ({
        type: 'taskItem',
        attrs: { checked: false, assignee: t.assignee ?? null, due: t.due ?? null },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: t.text }] }],
      })),
    },
  ],
});

const taskRow = (page: Page, text: string) => page.locator('.page-editor li[data-type="taskItem"]', { hasText: text });
const myTasks = (page: Page) => page.locator('.mytask');
const emptyTasks = (page: Page) => page.getByText('No open tasks for you');

async function switchUser(page: Page, user: { email: string; password: string }, to: string) {
  await page.context().clearCookies();
  await logIn(page, user, to);
}

let ids: { ed: string; eve: string; vera: string };

test.describe.serial('task lists', () => {
  test.beforeAll(resetDatabase);

  test('an editor gives a task a person and a due date; that person ticks it in My tasks and the page shows it ticked (dark mode too)', async ({
    page,
  }) => {
    await signUp(page, admin);
    await createSpace(page, { name: 'Allotment', key: 'allotment', defaultRole: 'editor' });
    ids = {
      ed: await addPerson(page, ed, 'editor'),
      eve: await addPerson(page, eve, 'editor'),
      vera: await addPerson(page, vera, 'viewer'),
    };
    const plan = await createPage(page, 'allotment', {
      title: 'Spring plan',
      doc: taskDoc([{ text: 'Water the ferns' }, { text: 'Sweep the porch' }]),
    });

    await switchUser(page, ed, plan.path);
    const row = taskRow(page, 'Water the ferns');
    await expect(row).toBeVisible();

    // Assign: a small searchable list of the people who can open the space.
    await row.hover();
    await row.getByRole('button', { name: 'Assign this task to a person' }).click();
    const picker = page.getByRole('dialog', { name: 'Assign task' });
    await picker.getByRole('combobox', { name: 'Find a person' }).fill('eve');
    await expect(picker.getByRole('option')).toHaveText(['Eve Editor']);
    await picker.getByRole('option', { name: 'Eve Editor' }).click();
    await expect(picker).toHaveCount(0);
    await expect(row.locator('.task-person')).toContainText('Eve Editor');

    // Due date, from the keyboard this time: Alt+Shift+D with the caret in the task.
    await row.getByText('Water the ferns').click();
    await page.keyboard.press('Alt+Shift+D');
    const due = page.getByRole('dialog', { name: 'Due date' });
    await due.getByLabel('Due date').fill(day(1));
    await due.getByRole('button', { name: 'Set date' }).click();
    await expect(row.locator('.task-due')).toContainText('Tomorrow');
    await expect(page.getByRole('status')).toHaveText('Saved', { timeout: 10_000 });
    // The other task has no chips.
    await expect(taskRow(page, 'Sweep the porch').locator('.task-chip:visible')).toHaveCount(0);

    // Eve finds it in My tasks, through the top bar link.
    await switchUser(page, eve, '/');
    await page.getByRole('link', { name: 'My tasks' }).click();
    await expect(page).toHaveURL('/tasks');
    await expect(myTasks(page)).toHaveCount(1);
    const mine = myTasks(page).first();
    await expect(mine).toContainText('Water the ferns');
    await expect(mine).toContainText('Tomorrow');
    await expect(mine.getByRole('link', { name: 'Allotment · Spring plan' })).toHaveAttribute('href', plan.path);
    await expect(page.getByRole('heading', { name: /Coming up/ })).toBeVisible();

    // Dark mode, once (reduced motion so the theme switch is settled).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(mine).toBeVisible();
    await page.screenshot({ path: 'test-results/tasks-dark.png', fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.emulateMedia({ reducedMotion: null });

    // Tick: the box ticks at once, the row fades out, and Undo is offered.
    const box = mine.getByRole('checkbox', { name: 'Done: Water the ferns' });
    await box.check();
    await expect(box).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Ticked “Water the ferns”.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(myTasks(page)).toHaveCount(0);
    await expect(emptyTasks(page)).toBeVisible();

    // The page shows it ticked, with its person and date still there.
    await page.goto(plan.path);
    await expect(taskRow(page, 'Water the ferns')).toHaveAttribute('data-checked', 'true');
    await expect(taskRow(page, 'Water the ferns').locator('.task-person')).toContainText('Eve Editor');
  });

  test('a viewer sees their task with the box disabled; nobody sees tasks in a space they cannot open; the trash takes a task out of My tasks', async ({
    page,
  }) => {
    await logIn(page, admin, null);
    const chores = await createPage(page, 'allotment', {
      title: 'Chores',
      doc: taskDoc([{ text: 'Check the shed', assignee: ids.vera, due: day(-2) }]),
    });
    await createSpace(page, { name: 'Vault', key: 'vault', visibility: 'restricted' });
    await createPage(page, 'vault', { title: 'Secrets', doc: taskDoc([{ text: 'Count the keys', assignee: ids.ed }]) });

    // Ed cannot open the restricted space, so its task is not in his list.
    await switchUser(page, ed, '/tasks');
    await expect(emptyTasks(page)).toBeVisible();
    await expect(page.getByText('Count the keys')).toHaveCount(0);

    // Vera sees her overdue task, with the box disabled and the reason why.
    await switchUser(page, vera, '/tasks');
    await expect(myTasks(page)).toHaveCount(1);
    const mine = myTasks(page).first();
    await expect(mine).toContainText('Check the shed');
    await expect(mine).toContainText('Overdue');
    await expect(mine).toContainText('You can view this page but not edit it');
    await expect(mine.getByRole('checkbox', { name: 'Done: Check the shed' })).toBeDisabled();

    // On the page the chips show, read-only.
    await mine.getByRole('link', { name: 'Allotment · Chores' }).click();
    const row = taskRow(page, 'Check the shed');
    await expect(row.locator('.task-person')).toContainText('Vera Viewer');
    await expect(row.locator('.task-due')).toContainText('Overdue');
    await expect(page.getByRole('button', { name: 'Assign this task to a person' })).toHaveCount(0);

    // The page goes to the trash: the task leaves her list.
    await switchUser(page, admin, null);
    expect((await page.request.delete(`/api/pages/${chores.id}`)).ok()).toBe(true);
    await switchUser(page, vera, '/tasks');
    await expect(emptyTasks(page)).toBeVisible();
  });
});
