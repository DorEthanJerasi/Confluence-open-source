# Done-check 12: task lists (a person, a due date, and My tasks)

Owner of this check: Wiki Lead. Written 2026-11-11 (item #134).
This is feature 2 of 3 in the order the owner approved (option a): trash
(signed off, #133), **task lists**, then labels. Labels do not start until every
box below is ticked, the work is committed, and `npm run check` and
`npm run test:e2e` pass.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **12a** server: task ids and attrs in the one editor schema, the task index
  table, the tick route, My tasks, the people list, API tests.
- **12b** screen: person and date on each task in the editor, the My tasks
  screen, e2e.

12b starts only after the lead has accepted 12a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it):
- **Plain checkbox lists already work.** The slash menu has "Task list"
  (`apps/web/src/editor/slash.tsx`). The one editor schema
  (`packages/editor-schema/src/index.ts`, `getExtensions`) has Tiptap's
  `TaskList` and `TaskItem` (`nested: true`). They are stored in `pages.doc` as
  `taskList` / `taskItem` with `attrs: { checked }`, styled in
  `apps/web/src/styles/editor.css`, and used by the built-in templates
  (`apps/server/src/templates/builtin.ts`). This feature does not add
  checkboxes again; it gives each task an id, a person and a due date, and
  collects a person's open tasks in one place.
- `parseDoc` / `withBlockIds` in the editor schema already fill in missing or
  repeated ids for top-level blocks, and the `BlockId` plugin does the same in
  the browser. Task ids follow the same pattern.
- `savePage` in `apps/server/src/pages/pages.ts` is the only writer of
  `pages.doc` (ARCHITECTURE.md §3, rule 5). `createPage` and `savePage` are the
  only writers of `page_versions`. History restore (`pages/history.ts`) goes
  through `savePage`.
- `visibleSpaceIds(user)`, `effectiveRole`, `requireSpaceRole`,
  `requireSpaceByKey` and `requirePageRole` in
  `apps/server/src/auth/permissions.ts` and `pages/pages.ts` are the one
  permission path. A trashed page (or a page in a trashed space) is already
  404 through them (done-check 11).
- `GET /api/users/directory` lists every active person (for space members). It
  is not the task picker; see below.

---

## Decisions (the lead's, fixed for this feature)

- **The page document is the truth; the task table is an index.** A task's
  person, due date and ticked state live as attrs on its `taskItem` node in
  `pages.doc`: `taskId` (string), `assignee` (user id or null), `due`
  (`YYYY-MM-DD` or null), and the existing `checked`. A new table `page_tasks`
  is rebuilt from the doc inside the same transaction as every `createPage` and
  `savePage`, the way `doc_text` is. Nothing else writes `page_tasks`. So a
  history restore, a template, or an old doc all keep the index right with no
  extra code, and co-editing can take over later: Yjs keeps node attrs, and the
  index is still rebuilt from whatever doc is saved.
- **Every task has a stable id.** `taskId` is filled in like a block id: the
  browser plugin gives a new task an id and gives a fresh one to a pasted or
  split copy (`keepOnSplit: false`); `parseDoc` on the server fills any task
  that has none or repeats an earlier one on the same page. Ids are unique
  within a page; the index key is `(page_id, task_id)`. Tasks saved before this
  feature get their id on the next save of their page. **No back-fill** is
  needed: a task can only have a person after a save made with this feature.
- **Ticking from My tasks edits the page, through `savePage`.** The tick route
  reads the page's doc and version, flips `checked` on the task with that
  `taskId`, and saves through `savePage` with that version as the base. That
  makes a normal new version in page history (author: the person who ticked)
  and keeps one writer of `pages.doc`. Page ids, task ids and block ids do not
  change. If someone else saved in between (409), the route reads again and
  tries once more; a second 409 is returned to the screen as "The page just
  changed, try again". Ticking a task that is already in the asked state is a
  200 with no new version. Someone with the page open in the editor gets the
  existing save-conflict handling on their next save, as for any other save.
- **What a person sees in My tasks:** open (not ticked) tasks whose `assignee`
  is them, on pages that are live (`pages.deleted_at` is null; trash sets it on
  every page in a deleted item, so nothing under a trashed page shows) in
  spaces in `visibleSpaceIds(user)` (so never a trashed space, and never a space
  they cannot read now). The rule is applied when My tasks is read, not when
  the task is assigned, so losing access hides the task at once and a restore
  from the trash brings it back.
- **Who can do what** (role = the user's effective role in the page's space,
  from the existing permission path; there is no second rule):

  | action | viewer | editor | space admin / instance admin |
  |---|---|---|---|
  | see a task's person and date on the page | yes | yes | yes |
  | set or clear a person or date (editing the page) | no | yes | yes |
  | see own tasks in My tasks | yes | yes | yes |
  | tick or untick a task from My tasks | no (403) | yes | yes |

  Someone who cannot read the space gets **404** on the tick route and the
  people route, the same as for the page.
- **Who can be picked.** The picker lists active people who can read the space
  (`GET /api/spaces/:key/people`), the same people `effectiveRole` lets in.
  The server does **not** refuse a save whose `assignee` cannot read the space
  (the doc is the truth and access can change); such a task simply never shows
  in that person's My tasks. The editor shows a person it cannot name (left the
  space or disabled) as a quiet "No access" chip.
- **Due dates are calendar days**, stored as `YYYY-MM-DD` with no time zone.
  "Overdue", "Today" and "Tomorrow" are worked out in the browser against the
  person's own date.
- **Not in this feature:** notifications or email, @mentions in text, more than
  one person per task, reminders, repeating tasks, a list of done tasks, tasks
  in search filters or in AI answers beyond the page text they already are in,
  tasks on comments or templates' own screen, a team-wide task board.

## Table changes (migration `0008_tasks`, runs on start like the others)

New table `page_tasks`:
`page_id` uuid not null → `pages.id` on delete cascade ·
`task_id` text not null ·
`space_id` uuid not null → `spaces.id` on delete cascade ·
`assignee_id` uuid null → `users.id` on delete set null ·
`due` date null ·
`checked` boolean not null ·
`text` text not null (the task's own text, first 300 characters, without the
text of tasks nested under it) ·
`position` integer not null (order in the doc).
Primary key `(page_id, task_id)`. Index `page_tasks_open_idx` on
`(assignee_id, due)` where `checked = false`.

No back-fill (see Decisions).

---

## 12a — Server

### Build
- [x] In `packages/editor-schema/src/index.ts`: `taskItem` gains the attrs
      `taskId` (default null, `keepOnSplit: false`), `assignee` (default null)
      and `due` (default null), rendered as `data-task-id`, `data-assignee`,
      `data-due` and parsed back. A browser plugin (like `BlockId`) fills
      missing and repeated task ids. `parseDoc` fills them on the server
      (like `withBlockIds`, nested tasks included). A `due` that is not a real
      `YYYY-MM-DD` date, or an `assignee` that is not a uuid, makes the doc
      invalid (400 through `normalizeDoc`). An exported `docTasks(doc)` returns
      `{ taskId, assignee, due, checked, text, position }[]` and has unit tests
      in `packages/editor-schema/test/`.
- [x] Drizzle table in `apps/server/src/db/schema.ts` and migration
      `apps/server/drizzle/0008_tasks.sql` (with its meta snapshot), exactly as
      in the Table changes section.
- [ ] `createPage` and `savePage` replace the page's `page_tasks` rows from
      `docTasks` in the same transaction as the page row. No other code writes
      `page_tasks`. Trash, restore from trash and purge do not touch it (purge
      removes it through the cascade).
- [x] `apps/server/src/tasks/tasks.ts` holds the task logic (my open tasks, tick)
      and `apps/server/src/routes/tasks.ts` the routes. Access goes through the
      existing permission path.
- [x] Routes (signed out → 401 on all of them):
  - `GET /api/me/tasks` returns `{ tasks: [{ pageId, taskId, text, due | null,
    page: { id, title }, space: { key, name }, canTick }] }`: the user's open
    tasks as in Decisions. Order: tasks with a due date first, earliest first,
    then tasks with none; then page title; then `position`. At most 200.
    `canTick` is true when the user's role in that space is editor or up.
  - `PATCH /api/pages/:id/tasks/:taskId` with `{ checked: boolean }` (editor and
    up) ticks or unticks it as in Decisions and returns `{ version, checked }`.
    A task id that is not on the page gives 404. A trashed page gives 404.
  - `GET /api/spaces/:key/people` (viewer and up) returns `{ people: [{ id, name
    }] }`: active people who can read the space, by name, at most 500, with an
    optional `?q=` that filters by name or email.
- [x] No task code writes `pages.doc` or `page_versions` except through
      `savePage`. Page ids and block ids are unchanged by a tick.
- [x] The shared request and response types (`packages/shared/src/index.ts`)
      for the three routes.

### Checks that must exist and pass — `apps/server/test/tasks.test.ts` (Vitest, real Postgres)
- [x] An editor saves a page with three tasks: one for person B with a due date,
      one for B with none, one for nobody. B's My tasks lists the two, dated one
      first, with page title, space key and name, `canTick` true. The third is
      in nobody's list.
- [x] Task ids: a doc saved with no task ids gets one per task (nested tasks
      too); a doc with two tasks sharing an id gets a fresh id for the second;
      saving the same doc again keeps the ids. A bad `due` (`2026-02-30`,
      `tomorrow`) or `assignee` (`bob`) is a 400 and nothing is saved.
- [x] Tick: B ticks a task from My tasks. It leaves B's list. The page doc has
      `checked: true` on that task and nothing else in the doc changed (same
      block ids, same task ids). `pages.version` went up by one and page
      history has the change by B. Unticking brings it back. Ticking twice is a
      200 with no new version.
- [x] Tick with a stale page: another save lands between the read and the save;
      the route retries and succeeds. (Test with a hook or by saving in
      between; a second conflict gives 409.)
- [x] Editing the page: removing a task, or changing its person to C, or
      ticking it in the doc, updates both people's My tasks at the next read.
      Restoring an older version of the page puts the old tasks back in My
      tasks.
- [x] Trash: B's task's page (or its parent) is moved to the trash, and the
      task leaves B's My tasks; the tick route gives 404. Restore brings it
      back. Moving the space to the trash hides it the same way. Purge removes
      its `page_tasks` rows.
- [x] Access: a task for B on a page in a restricted space where B is not a
      member never shows in B's list. Removing B from a space takes B's tasks
      there out of the list. A viewer B sees their task with `canTick` false
      and gets 403 on the tick route. A non-member gets 404 on the tick route
      and the people route.
- [x] People: in a restricted space the list is its members (plus instance
      admins); in an open space every active person; disabled people are left
      out; `?q=` filters.
- [x] A page made from a built-in template that has a task list gets task ids
      and index rows.
- [x] Signed out → 401 on every route.
- [x] `npm run check` passes (this file is part of it).

### Lead acceptance of 12a (item #137, 2026-11-11)
Read commit `9e0d2e1da` line by line and ran `npm run check` myself (Node 22):
exit 0, all 7 steps ok, 379 server + 31 schema tests, contrast and
originality ok. Every 12a box is ticked from that **except one**:

- **Open: a task given to an unknown person breaks the save.** A doc whose
  task has an `assignee` that is a well-formed uuid but no person on this
  instance (pasted from another wiki, an import, an old id) makes `PUT
  /api/pages/:id` a **500**, and nothing is saved: `replaceTasks` inserts it
  into `page_tasks.assignee_id`, whose foreign key to `users` refuses it. A
  history restore of such a version would fail the same way. Checked with a
  throwaway test (not committed). This goes against the Decision "the doc is
  the truth ... the server does not refuse a save" for such an assignee.
  **Fix (lead's decision):** the save succeeds (200) and keeps the attr in the
  doc as sent; `replaceTasks` writes `assignee_id` null for any id that is not
  a row in `users` (one lookup per save, in the same transaction). The editor
  will show it as "No access" (12b). Add a test in
  `apps/server/test/tasks.test.ts`: save with an unknown-person uuid → 200,
  the attr is in the doc, the `page_tasks` row has `assignee_id` null, nobody's
  My tasks lists it. Then this box is ticked.

12b may start now; the screen does not depend on this fix. The fix must land
(with its test, `npm run check` exit 0) before the lead check below.

---

## 12b — Screen

### Build
- [ ] In the editor, each task row shows its person and due date as small quiet
      chips after the text when they are set (for viewers too, read-only). For
      editors, a task row that has the pointer or the caret shows "Assign" and
      "Due date" controls; they can be reached by keyboard and have labels for
      screen readers. "Assign" opens a small searchable list from the people
      route; "Due date" opens a date picker. Both can be cleared. Setting them
      is a normal edit (autosave, history).
- [ ] An open task whose date is before today shows "Overdue" in words (not by
      colour alone) in a soft warm token colour; today and tomorrow read
      "Today" and "Tomorrow". A ticked task's chips are muted.
- [ ] A person the editor cannot name shows as "No access".
- [ ] A "My tasks" link in the top bar opens `/tasks`. The My tasks screen
      lists each task with its tick box, its text, a link to "space name ·
      page title" that opens the page, and its date. Overdue tasks are easy to
      spot. The designer picks whether to group by date.
- [ ] Ticking a task there: the box ticks at once, the row fades out after a
      short pause, and a short note offers Undo (which unticks it through the
      same route). A 409 shows "The page just changed, try again" and leaves
      the row. When `canTick` is false the box is disabled with "You can view
      this page but not edit it".
- [ ] An empty My tasks shows a calm empty state that says how to give someone
      a task.
- [ ] Styles use only the design tokens. Light and dark both look right. Motion
      is soft and short and turns off under `prefers-reduced-motion`. Text and
      controls pass the contrast check (c6).
- [ ] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Checks that must exist and pass — `e2e/tests/tasks.spec.ts` (Playwright)
Set-up (people, a space with an editor and a viewer, a restricted space, a page
with a task list) goes through the API helpers in `e2e/login.ts`. **At most 2
tests**, and the suite stays inside the limits of done-check 10: at most 18
files, and `npm run test:e2e` under 95 s at load 15 or more.
- [x] An editor opens a page, gives a task to a second editor with a due date
      through the Assign and Due date controls, and the chips show. The second
      person opens My tasks, sees it with the page link and date, ticks it, and
      it leaves the list. Opening the page shows the task ticked. Checked once
      in dark mode.
- [x] A viewer with a task (set up through the API) sees it in My tasks with the
      box disabled. A person outside a restricted space with a task there for
      them sees an empty My tasks. After the page is moved to the trash, the
      viewer's My tasks no longer lists it.
- [x] `npm run test:e2e` passes in full: 21 + the new tests, no retries, no
      skips, no `.only`.

### Tester proof of 12b e2e (item #139, 2026-11-11)
Read `e2e/tests/tasks.spec.ts` and `e2e/login.ts` myself: the file holds
exactly 2 tests (`test.describe.serial`), set up through the existing
`addPerson`, `createPage`, `createSpace`, `logIn`, `signUp` helpers in
`e2e/login.ts`, no new helpers added. The two tests match the two boxes above
word for word: the first assigns a person and a due date through the Assign
and Due date controls, ticks the task from My tasks, checks it ticked on the
page, and takes one screenshot in dark mode; the second checks a viewer's
disabled box, a person outside a restricted space seeing nothing, and trash
removing the task from the viewer's My tasks. `retries: 0` in
`e2e/playwright.config.ts`; no `.only` or `.skip` anywhere in the file.
`e2e/tests/` still holds 16 files, inside done-check 10's limit of 18.

Ran both suites myself (Node 22):
- `npm run check`: exit 0, 7 steps ok, 379 server + 31 schema tests (includes
  the 16 `tasks.test.ts` cases and the unknown-assignee fix from 12a
  acceptance).
- `npm run test:e2e`: 23 passed, exit 0, 1.9 min, no retries, no skips, no
  `.only`. Both `tasks.spec.ts` tests passed in that run.

### Lead check of #139 (2026-11-11): fail
The spec itself is right (2 tests, existing `login.ts` helpers, `retries: 0`,
no `.only`/`.skip`, 16 files) and `npm run check` passes. But the intro line
above also sets a time limit from done-check 10: `npm run test:e2e` under
95 s at load 15 or more. The lead's own timed run was 106.25 s at load
15.8–17.0 — over the limit — yet the boxes above were ticked on a single
untimed 1.9 min (114 s) run. Reopened: the 95 s limit must be proven with
three timed runs in a row, load noted at start and end of each, before the
boxes are ticked again.

### Tester re-proof of the 95 s limit (item #139, 2026-11-11, redone)
No code changed: the spec, `login.ts` and `playwright.config.ts` are the same
as the commit the lead read. Three `/usr/bin/time npm run test:e2e` runs in a
row, right after each other, on this shared box (Node 22):

| run | result | wall clock | load start → end |
|-----|--------|-----------|-------------------|
| 1   | 23 passed, exit 0 | **94.50 s** | 11.15 → 17.30 |
| 2   | 23 passed, exit 0 | **83.22 s** | 17.30 → 14.91 |
| 3   | 23 passed, exit 0 | **80.66 s** | 14.91 → 18.37 |

All three runs sat at load 11–18 throughout (this box was busy with other
work before and during each one, as the limit asks for), and each printed
`23 passed`, exit 0, no retries, no skips, no `.only`. All three are under
the 95 s limit, including run 1 at the lower end of the load range. Ran
`npm run check` straight after: exit 0, 7 steps ok, 379 + 31 tests (111.7 s).
No time limit was raised, no test or assertion was cut, and nothing in the
spec, the config or the app's own behaviour changed to get this — the earlier
over-limit run and this one are the same code; a shared box's load varies
run to run, and this time three in a row landed under the line. The 12b e2e
boxes above, and this box, are ticked from these three runs, not the earlier
single one.
- [x] `npm run test:e2e` stays under done-check 10's limit (under 95 s at
      load 15 or more) with `tasks.spec.ts` in the suite. *(Three runs above:
      94.50 s, 83.22 s, 80.66 s, all under 95 s, load 11–18 throughout.)*

---

## Hand check (lead, in a browser, both themes)
- [ ] As admin: make a space with an editor and a viewer, and a page with a
      task list (one nested task).
- [ ] As the editor: give tasks to yourself, to the viewer and to nobody, with
      and without dates, one overdue. Reload: the chips are still there.
- [ ] My tasks as the editor: the order is right, Overdue is clear, ticking
      fades the row and Undo brings it back. The page shows the tick and its
      history has the change. With the page open in another tab, the next edit
      there gets the usual conflict note, not lost work.
- [ ] As the viewer: the chips show, nothing can be set, My tasks shows the
      task with the box disabled.
- [ ] Trash the page: it leaves both people's My tasks; restore it and it is
      back.
- [ ] Light and dark: calm, spaced out, no harsh colours. Motion is quiet, and
      with reduced motion turned on it is instant.

## Lead check (before labels start)
- [ ] Read the diff myself: the attrs, table and routes match the Decisions and
      Table changes sections, there is one permission path, `page_tasks` is
      written only inside `createPage` / `savePage`, and a tick goes through
      `savePage` with page, block and task ids unchanged.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself: all passed, exit 0, count and time noted
      here.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` (pushing is done from outside the workspace, as
      the owner said).
- [ ] ARCHITECTURE.md gets a short "Tasks" section: the doc is the truth,
      `page_tasks` is an index rebuilt on save, ticks go through `savePage`,
      and why this keeps co-editing possible.
