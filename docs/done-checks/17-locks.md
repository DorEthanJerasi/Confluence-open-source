# Done-check 17: single-page locks

Owner of this check: Wiki Lead. Written 2026-11-13 (item #179).
This is feature 3 of 3 in the order the owner approved on 2026-11-11 (option
a): mentions, notifications and following (done-check 15), export to
Markdown/PDF (done-check 16), then **single-page locks**. Locks are done only
when every box below is ticked, the work is committed, and `npm run check`
and `npm run test:e2e` pass with exit 0.

**When the build may start.** Under the rule written in item #165 (top of
done-check 15), building locks starts once the lead has signed export off.
On the day this was written, export is **not signed off yet**. Three boxes
are still open in done-check 16: the full e2e run and the timing rule (run 2
of item #176 failed, the middle run was 109 s), the self-host engineer's
`docker compose build` (no Docker daemon in this workspace), and the lead's
own `npm run check` and e2e runs. This file can be written now. Item 17a
cannot start before that sign-off.

**Push.** The workspace still has no GitHub address (`git remote -v` is
empty on 2026-11-13). As for every feature since #165, the push box below
stays open and says it is waiting on the owner's GitHub address. Everything
is committed on `master` locally and pushed as soon as the owner gives the
address.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **17a** server: the lock columns, lock and unlock, the one check in the
  write path, the trash, restore and template rules, the server tests.
- **17b** screen: the Lock button, the quiet "Locked by X" note, the
  read-only editor, and the one e2e test.

17b starts only after the lead has accepted 17a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it):
- `requirePageRole`, `requireSpaceRole`, `effectiveRole` and
  `requireSpaceByKey` (`apps/server/src/auth/permissions.ts`,
  `pages/pages.ts`) are the one permission path. "Editor and up" there
  already includes space admins and instance admins.
- **`savePage` in `apps/server/src/pages/pages.ts` is the single write path**
  for a page's title and body. Everything that changes them goes through it:
  `PUT /api/pages/:id`, `restoreVersion` in `pages/history.ts`, and
  `tickTask` in `tasks/tasks.ts`. Its `update … where version = baseVersion
  and deleted_at is null` is where the lock check belongs.
- `trashPage` in `trash/trash.ts` calls `deletePage`, which trashes a page
  and every live page under it in one statement. `restorePage` and
  `restoreSpace` bring them back with their columns as they were.
- Templates only read a page (`createTemplate` with `fromPageId`, "Save as
  template") and only make new pages (`pageDocFromTemplate`). No template
  action writes into an existing page.
- `HttpError(status, code, message)` in `apps/server/src/http.ts`.
- E2E set-up helpers in `e2e/login.ts`: `addPerson`, `createSpace`,
  `createPage`, `logIn`, `signUp`.

---

## Decisions (the lead's, fixed for this feature)

- **What a lock is.** A flag on one page saying its title and body may not be
  changed until someone unlocks it. It is stored on the page row as two new
  nullable columns, `locked_at` (timestamp) and `locked_by` (user id, `on
  delete set null`), in a new migration `0011_page_locks.sql`. Both are set
  together or both are null. A lock belongs to the page, not to the person:
  it is not a lease, it does not time out, and there is no lock table.
- **Who can lock and unlock.** Anyone with the **editor role or above in
  that space** (`requirePageRole(editor)`), so space admins and instance
  admins too. Any such person can unlock a page, not only the one who locked
  it; the note says who did, so the team can ask. A **viewer gets 403**, and
  someone who cannot read the space gets **404**, as for every page route.
  Signed out is **401**. A page in the trash is 404.
- **The routes.** `POST /api/pages/:id/lock` and `POST /api/pages/:id/unlock`.
  Both answer `{ lock }` with the new state. Locking a locked page, or
  unlocking an unlocked one, is a no-op that answers the current state
  (200, nothing written), so a double click or two people at once do no harm.
  Locking and unlocking **do not change** `pages.version`, `updated_at`,
  `updated_by`, the document, the search text or `page_versions`, so a lock
  never shows up as an edit in history, "recently updated" or followers'
  edit notifications.
- **`GET /api/pages/:id` gains `lock`:** `null`, or `{ at, by: { id, name } |
  null }` (`by` is null if that person's user row is ever gone; the screen
  then says "Locked"). Shared type `PageLock` in `packages/shared`.
- **Locked means read-only for everyone, the locker included.** While a page
  is locked, every change to its **title or body** is refused with **423**
  and the code `page_locked` and a plain message ("This page is locked by
  Ada Lind. Unlock it to make changes."). That covers:
  - saving the page (`PUT /api/pages/:id`);
  - restoring an older version from history;
  - ticking or unticking a task on it (`tickTask`);
  - trashing it (see Trash below).
  The check is made **inside `savePage`'s own `update` statement** (`and
  locked_at is null` next to the version check), not by a read before it, so
  a save that races a lock can never slip through. When the update matches no
  row, `savePage` tells "locked" (423) apart from "stale" (409) and "gone"
  (404) by reading the row once, as it already does for 409. Nothing else
  needs its own check, because restore and task ticks already go through
  `savePage`.
- **What a lock does not stop** (written down so nobody adds it later by
  accident): reading, export, search and AI answers; comments and replies;
  labels; following and favourites; moving the page in the tree; making new
  sub-pages under it. A lock protects what the page says, not the talk
  around it or where it sits. Sub-pages are **not** locked by their parent's
  lock; each page is locked on its own.
- **Trash respects the lock.** Trashing a locked page is refused with 423
  and the same message. Trashing a page that has a **locked live page
  anywhere under it** is refused with 423 too, naming the first locked
  sub-page ("“Budget” under this page is locked by Ada Lind. Unlock it
  first."), and nothing is trashed. The check and the trash happen in one
  transaction, so a lock set in between cannot be skipped. **Trashing a whole
  space** (space admins only) is still allowed: it is an admin's decision
  about everything in it, and it can be restored. A page that was locked when
  it went to the trash (with its space) **comes back still locked** on
  restore, with the same `locked_at` and `locked_by`. Purging a page purges
  its lock with it.
- **Restore (page history) respects the lock.** The History panel still
  opens and shows every version on a locked page, but restore answers 423.
  Unlock, then restore.
- **Templates respect the lock.** "Save as template" from a locked page works
  (it only reads). A lock is **never copied**: a template made from a locked
  page holds no lock, and a page made from any template starts unlocked.
- **Why co-editing can still be added without a rewrite.** The lock is a
  flag on the page row, checked in the one write path. A future co-editing
  server still writes through `savePage` (and would check the same flag
  before taking edits, and close live sessions when a page is locked).
  Nothing about the lock lives in the document, so the Yjs state and the
  stored JSON are untouched. Stable page ids are unchanged.
- **The screen.**
  - A **Lock** button in the page header with Follow, the star and Export,
    shown only to editors and up. On a locked page it reads **Unlock**.
    Viewers never see it.
  - On a locked page, everyone (viewers included) sees one quiet line under
    the title: a small lock icon and "Locked by Ada Lind · 12 Nov". Not a
    warning colour, not a banner; muted text in the design tokens.
  - On a locked page the editor is **read-only for everyone**: no typing, no
    slash menu, no drag handles, the title is not editable, task boxes cannot
    be ticked, and History has no Restore button (a short muted line says
    "Unlock the page to restore a version"). The Delete / Move to trash
    action is disabled with the same hint.
  - If someone has the page open for editing when another person locks it,
    their next save gets the 423. The screen then turns read-only, shows the
    "Locked by X" line, and keeps their unsaved text visible in a quiet note
    with a Copy button, so nothing they typed is lost silently.
  - Lock and Unlock change the note with the same soft fade as the rest of
    the app, and the fade is off under `prefers-reduced-motion`.
- **Not in this feature:** locking a whole space or a whole branch at once,
  locks that run out after a time, per-person locks or "only the locker may
  unlock", a request-to-unlock message, notifications for lock and unlock,
  showing locks in the sidebar or in search results.

---

## 17a — Server

### Build
- [ ] Migration `apps/server/drizzle/0011_page_locks.sql` adds `locked_at`
      and `locked_by` to `pages` (both nullable, `locked_by` references users
      `on delete set null`), plus a check that both are null or both are
      set. `apps/server/src/db/schema.ts` matches. Migrations still run on
      start.
- [ ] `apps/server/src/pages/locks.ts` with `lockPage` and `unlockPage`
      (editor and up, no-op when already in that state, no change to version,
      `updated_at`, document or history). Routes `POST /api/pages/:id/lock`
      and `/unlock` in `apps/server/src/routes/pages.ts`.
- [ ] `savePage` refuses a locked page inside its `update` statement and
      answers 423 `page_locked` with the locker's name; 409 and 404 work as
      before.
- [ ] `trashPage` refuses a locked page, or a page with a locked live page
      under it, with 423, in one transaction with the trash. `trashSpace`,
      `restorePage`, `restoreSpace` and the purges are unchanged and keep the
      lock columns.
- [ ] Shared type `PageLock` and `Page.lock` in `packages/shared/src/index.ts`;
      `GET /api/pages/:id` returns `lock`.

### Checks that must exist and pass — `apps/server/test/locks.test.ts` (Vitest, real Postgres)
- [ ] Who: in a restricted space, an editor member and a space admin can lock
      and unlock (200); a viewer member gets 403; an editor who is not a
      member gets 404; signed out gets 401; a trashed page gets 404. Any
      editor can unlock a page another editor locked.
- [ ] No-op and no trace: locking twice and unlocking twice answer the state
      with nothing written; after lock and unlock, `pages.version`,
      `updated_at`, `updated_by`, `doc`, `doc_text` and the count of
      `page_versions` are the same as before, and no notification row is
      made for followers.
- [ ] `GET /api/pages/:id` shows `lock` with the locker's id and name, and
      `null` after unlock; `by` is null after the locker's user row is
      removed (directly in the test database; the app has no account
      delete today), and the page stays locked.
- [ ] Read-only for everyone: on a locked page, `PUT /api/pages/:id` by the
      locker, by another editor and by an admin all get 423 `page_locked`
      with the plain message, and the page is unchanged. After unlock, the
      same save with the same `baseVersion` succeeds.
- [ ] Race: a save whose read happens before a lock and whose update happens
      after it (made with a test hook, as `tickTask` already has) gets 423,
      not a saved version.
- [ ] Restore: on a locked page, listing and reading versions work; restore
      gets 423 and writes nothing. After unlock it works.
- [ ] Tasks: ticking a task on a locked page gets 423 and the doc is
      unchanged.
- [ ] Trash: trashing a locked page gets 423; trashing its parent gets 423
      naming the locked sub-page, and neither page is in the trash. After
      unlock both trash. Trashing the space as its admin works with a locked
      page in it; restoring the space brings the page back still locked, with
      the same `locked_at` and `locked_by`.
- [ ] Templates: "Save as template" from a locked page works and the template
      has no lock; a page made from that template is unlocked.
- [ ] Not blocked: on a locked page, comments, labels, follow, favourite,
      export, search, moving it and making a sub-page under it all still
      work; the sub-page is not locked.
- [ ] `npm run check` passes (this file is part of it), and the originality
      scan (c5) passes on the new code and texts.

---

## 17b — Screen

### Build
- [ ] Lock / Unlock button in the page header (editors and up only), the
      quiet "Locked by X · date" line for everyone, and the read-only editor,
      title, task boxes, History restore and trash action on a locked page,
      as in Decisions. Keyboard works and the button and note have proper
      labels for screen readers.
- [ ] A 423 while editing turns the page read-only, shows the note, and keeps
      the unsaved text in a quiet note with Copy. A 423 on trash or restore
      shows the server's plain message as a quiet note, not an error page.
- [ ] Styles use only the design tokens. Light and dark both look right.
      Motion is soft and short and turns off under `prefers-reduced-motion`.
      Text and controls pass the contrast check (c6).
- [ ] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Check that must exist and pass — e2e (Playwright)
**Time cost: at most one short test, in an existing file.** `e2e/tests/`
has 18 files, done-check 10's limit, so locks adds **no new file**; the
tester puts the test in `editor.spec.ts` or `permissions.spec.ts`, whichever
has the right set-up. All set-up goes through the API in `e2e/login.ts`. The
test must be **no slower than the middle test of the same run**, in
Playwright's per-test output, and the run must exit 0 (the rule of
done-check 15 and 16). Everything the 17a boxes prove stays proved by the
server tests; the browser test proves only what only a browser can.
- [ ] One test: an **editor** locks a page; the "Locked by" line shows and the
      editor cannot type into the page. A **viewer** opening the same page
      sees the line and no Lock button. The editor unlocks, types, and the
      page saves.
- [ ] `npm run test:e2e` passes in full with the new test (27 + 1 = 28 tests
      if export's count holds), no retries, no skips, no `.only`.
- [ ] Time, under done-check 10's rule as rewritten in item #147: at least
      three timed `/usr/bin/time npm run test:e2e` runs by the tester with the
      locks test in the suite, load noted at the start and end of each, raw
      logs kept in `docs/done-checks/logs/`, **every run passes with exit 0
      and the middle run is under 95 s**. The locks test's own time and its
      rank are written next to the middle test's time for every run. If the
      locks test is slower than the middle test, it is cut back first; no
      limit is raised and no other test is dropped to make room. A run where
      the machine is so loaded that the test servers do not start is written
      down and does not count either way.

---

## Hand check (lead, in a browser, both themes)
- [ ] As admin: a restricted space with an editor and a viewer who are
      members, and an outsider who is not. A page "Budget" with a task list,
      under a page "Plans", with a few versions in its history.
- [ ] Two windows: the editor has "Budget" open and is typing; the admin
      locks it. The editor's next save turns the page read-only with "Locked
      by" and the unsaved text in the Copy note; nothing is lost silently.
- [ ] On the locked page: the title, the body and the task boxes cannot be
      changed; History opens but has no Restore; the trash action is
      disabled. Trashing "Plans" says "Budget" is locked. Comments, labels,
      follow, favourite and export still work.
- [ ] As the viewer: the note shows, no Lock button. As the outsider: 404.
- [ ] Unlock as the editor (not the one who locked it): editing, restore and
      trash work again. History shows no extra version for the lock or the
      unlock.
- [ ] Light and dark: the button and the note are calm and soft, not alarming.
      Motion is quiet, and with reduced motion turned on it is instant.
      Keyboard alone can lock and unlock.

## Lead check
- [ ] Read the diff myself: the lock is checked in `savePage`'s own update,
      not before it; lock and unlock write no version, document or history;
      trash checks the whole branch in one transaction; restore and task
      ticks are blocked only through `savePage`; locks are never copied into
      templates; one permission path.
- [ ] Ran `npm run check` myself: exit 0, log in `docs/done-checks/logs/`.
- [ ] Ran `npm run test:e2e` myself, timed: all passed, exit 0, count, time
      and load noted here, and my run is added to the time record above.
- [ ] Hand check above done and ticked.
- [ ] `docker compose build` and the smoke script still pass with the new
      migration (self-host engineer's run, read back by the lead). While no
      Docker daemon is reachable from the workspace, this box stays open and
      says so.
- [ ] ARCHITECTURE.md gets a short "Page locks" section (section 21): the
      flag on the page row, the one check in `savePage`, what a lock does and
      does not block, trash and restore, and why co-editing can still be
      added.
- [ ] Committed on `master` and pushed to GitHub, as the owner asked. While
      the workspace has no GitHub address, this box stays open and says it is
      waiting on the owner.
- [ ] Lead sign-off written here.
