# Done-check 15: @mentions, notifications and page following

Owner of this check: Wiki Lead. Written 2026-11-11 (item #155).
This is feature 1 of 3 in the order the owner approved on 2026-11-11 (option
a): **mentions, notifications and following**, then export to Markdown/PDF,
then single-page locks. The keyboard fix the owner asked for first is done
(#154, `7241b4060`). Mentions are done only when every box below is ticked,
the work is committed and pushed (see the last lead box), and
`npm run check` and `npm run test:e2e` pass with exit 0. Export does not start
before that.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **15a** server: the mention node in the editor schema, the two tables, the
  rules for who gets told what, the routes, the server tests.
- **15b** screen: `@` in the editor, the follow button, the bell with its
  unread count and the notification list, the one e2e test.

15b starts only after the lead has accepted 15a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it):
- `visibleSpaceIds(user)`, `effectiveRole`, `requireSpaceRole`,
  `requireSpaceByKey` and `requirePageRole` in
  `apps/server/src/auth/permissions.ts` and `pages/pages.ts` are the one
  permission path. A trashed page, a page under a trashed page, and every page
  in a trashed space are already 404 through them (done-check 11).
- **The person picker for tasks:** `GET /api/spaces/:key/people?q=`
  (`spacePeople` in `apps/server/src/tasks/tasks.ts`) lists active people who
  can read the space. `@` suggestions use this same route; there is no second
  people list.
- **How a task names a person:** the `taskItem` node keeps a user id in its
  `assignee` attr (`packages/editor-schema/src/index.ts`), a bad id makes the
  doc a 400, and `docTasks(doc)` reads them out. `createPage` and `savePage`
  rebuild `page_tasks` from the doc in the same transaction
  (`replaceTasks` in `pages/pages.ts`). Mentions copy this shape.
- `savePage` is the only way a page's doc changes: edits, task ticks and
  history restore all go through it. `createPage` is the only way a page is
  made (templates included).
- Comments: `createComment` in `apps/server/src/comments/comments.ts`.
- Personal lists (`apps/server/src/me/personal.ts`, routes under `/api/me`)
  show how to filter rows when read; notifications follow the same pattern.
- E2E set-up helpers in `e2e/login.ts`: `addPerson`, `createSpace`,
  `createPage`, `logIn`, `signUp`.

---

## Decisions (the lead's, fixed for this feature)

- **A mention is a person id in the page document, the same way a task
  assignee is.** It is a new inline node `mention` in the one editor schema
  with two attrs: `userId` (a uuid, required) and `label` (the person's name
  when they were mentioned, used only if the name cannot be looked up). It is
  an atom (the caret steps over it whole), round-trips through HTML as
  `<span data-mention data-user-id="…">@Name</span>`, and a `userId` that is
  not a uuid makes the doc invalid (400). `docMentions(doc)` in the schema
  package returns the set of user ids mentioned. In the page's plain text
  (search, AI) a mention reads as `@` + its `label`. The screen shows the
  person's current name.
- **Nothing is refused for naming someone.** As with tasks, a save that
  mentions someone who cannot read the space, or an id that is nobody here,
  is kept in the doc as sent. That person is simply never told, and the
  editor shows the chip as "No access" (or "Unknown person").
- **Who is told, and when.** A notification is written in the **same
  transaction** as the thing it is about, so it can never be lost or
  doubled:
  - **mention** — `createPage` and `savePage` compare the people mentioned
    before and after; each person **newly** mentioned gets one. Saving the
    same doc again tells nobody. Removing a mention and adding it back later
    tells them again. A history restore is a save, so it follows the same
    rule.
  - **comment** — `createComment` (a thread or a reply) tells everyone who
    follows the page.
  - **edit** — `savePage` tells everyone who follows the page. Autosave saves
    often, so edits **fold**: while a person has an unread edit notification
    for a page, a further save updates that one row (newest editor, time, and
    a count of saves) instead of adding another. Once they read it, the next
    save starts a new one.
  - Never yourself: the person who did it is never told about their own
    action. Disabled people are never told.
  - Only people who can read the page at that moment are written a
    notification (the same rule as `spacePeople`: instance admin, or the
    space is open, or they are a member).
- **Nobody sees a notification about a page they could not open.** On top of
  the write rule, every read of notifications (the list and the unread count)
  is filtered when it is read: the page must be live (`pages.deleted_at` is
  null, so nothing in or under a trashed page) and in a space from
  `visibleSpaceIds(user)` (so never a trashed space or a space they cannot
  read now). A comment notification whose comment is deleted is hidden too.
  The unread count uses exactly the same filter as the list, so the number
  and the list can never disagree. Losing access hides them at once; getting
  access back, or a restore from the trash, brings them back. There is no
  clean-up job; purge removes them by cascade.
- **Following.** Anyone who can read a page (viewers too) can follow and
  unfollow it. You follow a page automatically when you **create** it and
  when you **post a comment** on it (insert if missing, so it never undoes an
  unfollow you made later than that). Being mentioned does not make you
  follow. Following a page does not follow its sub-pages.
- **Stable ids.** Notifications and follows hold only ids (user, page, actor,
  comment) and a time, never a copy of the page text or a title. The screen
  reads the title and names when it lists them, so a renamed page shows its
  new title. Nothing is renumbered.
- **How fresh.** The bell asks for the unread count when the app opens, every
  60 s while the tab is visible, on window focus, and after you open the list.
  No live push in this feature.
- **Who can do what** (role = the user's effective role in the page's space,
  from the existing permission path; there is no second rule):

  | action | viewer | editor | space admin / instance admin |
  |---|---|---|---|
  | be suggested after `@` and be mentioned | yes (if they can read the space) | yes | yes |
  | add a mention (it is an edit of the page) | no (cannot edit) | yes | yes |
  | follow / unfollow a page | yes | yes | yes |
  | see own notifications and unread count | yes (only pages they can see) | yes | yes |
  | see anyone else's notifications or follows | no | no | no (admins included) |

  Someone who cannot read the space gets **404** on the page's follow routes,
  the same as for the page. Notification routes are always about the signed-in
  person only: marking someone else's notification as read is a 404.
- **Why co-editing can still be added without a rewrite.** A mention is an
  atom node with attrs, which Yjs keeps as they are, and the notification
  diff runs inside `savePage`, so a co-editing server that saves through
  `savePage` tells the same people with no change. Follows and notifications
  sit beside the document in their own tables and never write `pages.doc`,
  `pages.version`, `pages.updated_at` or `page_versions`.
- **Not in this feature:** email or push notifications, live push of the
  count, mentions inside comments (comments stay plain text), mentioning a
  whole space or group, following a space or a page tree, notification
  settings per kind, digests, deleting single notifications, a "who follows
  this" list.

## Table changes (migration `0010_mentions_notifications`, runs on start like the others)

New table `page_follows`:
`user_id` uuid not null → `users.id` on delete cascade ·
`page_id` uuid not null → `pages.id` on delete cascade ·
`created_at` timestamptz not null default now().
Primary key `(user_id, page_id)`. Index `page_follows_page_idx` on
`(page_id)`.

New table `notifications`:
`id` uuid primary key default `gen_random_uuid()` ·
`user_id` uuid not null → `users.id` on delete cascade (who is told) ·
`kind` text not null, one of `mention`, `comment`, `edit` (check constraint) ·
`page_id` uuid not null → `pages.id` on delete cascade ·
`actor_id` uuid null → `users.id` on delete set null (who did it) ·
`comment_id` uuid null → `page_comments.id` on delete cascade ·
`count` integer not null default 1 (saves folded into an edit notification) ·
`created_at` timestamptz not null default now() (moves forward when an edit
folds in) ·
`read_at` timestamptz null.
Index `notifications_user_idx` on `(user_id, created_at desc)`. Partial unique
index `notifications_edit_unread_idx` on `(user_id, page_id) where kind =
'edit' and read_at is null` (this is what makes edits fold, as an upsert).

No back-fill. Existing pages have no followers until someone follows them or
comments on them.

---

## 15a — Server

### Build
- [x] The `mention` node in `packages/editor-schema/src/index.ts` as in
      Decisions, in the one schema used by the browser and the server, and
      `docMentions(doc)`. The page's plain text shows a mention as `@label`.
- [x] Shared request and response types in `packages/shared/src/index.ts` for
      the routes below.
- [x] Drizzle tables in `apps/server/src/db/schema.ts` and migration
      `apps/server/drizzle/0010_mentions_notifications.sql` (with its meta
      snapshot), exactly as in the Table changes section.
- [x] `apps/server/src/notifications/notifications.ts` holds the follow and
      notification logic; `apps/server/src/routes/notifications.ts` the
      routes. `createPage`, `savePage` and `createComment` call it inside
      their own transaction. No notification or follow code writes `pages` or
      `page_versions`.
- [x] Routes (signed out → 401 on all of them):
  - `GET /api/pages/:id` gains `following: boolean`.
  - `PUT /api/pages/:id/follow` and `DELETE /api/pages/:id/follow` (viewer and
    up) return `{ following }`. Doing either twice is 200 with no change.
  - `GET /api/me/notifications?before=` returns `{ notifications: [{ id,
    kind, page: { id, title, space: { key, name } }, actor: { id, name } |
    null, commentId, count, createdAt, readAt }], more }`, newest first, 30 at
    a time, filtered as in Decisions.
  - `GET /api/me/notifications/unread` returns `{ count }` with the same
    filter.
  - `POST /api/me/notifications/read` with `{ ids }` marks those as read, or
    with `{ all: true }` marks every one of yours as read; returns
    `{ count }` (unread left). Ids that are not yours are ignored (404 if none
    of them are yours).

### Checks that must exist and pass — `apps/server/test/notifications.test.ts` (Vitest, real Postgres)
- [x] Schema: a doc with a mention round-trips through JSON and HTML with the
      same `userId` and `label`; a `userId` that is not a uuid is a 400 on
      save; `docMentions` finds mentions in a paragraph, a list, a table cell
      and a task item; the page's plain text has `@label`.
- [x] Suggestions: in a restricted space, `GET /api/spaces/:key/people?q=`
      lists members and instance admins and never a non-member or a disabled
      person (one test that the existing route already does this for the
      `@` picker).
- [x] Mentions: an editor saves a doc mentioning Vi (a viewer of the space).
      Vi gets one `mention` notification with the editor as actor. Saving the
      same doc again adds none. Removing the mention and adding it back adds
      one more. Mentioning yourself adds none. Mentioning a non-member of a
      restricted space, or an id that is nobody, saves fine (200) and writes
      nothing. A page made with a mention in its first doc tells that person.
      A history restore that brings a mention back tells them.
- [x] Follow: the creator follows a new page; commenting makes the commenter
      follow; `PUT`/`DELETE` work twice with no change; a viewer can follow;
      a non-member of a restricted space gets 404; `GET /api/pages/:id` shows
      `following`.
- [x] Comment and edit: a follower is told about a comment and a reply by
      someone else, not about their own. Three saves by another person while
      the follower has not read make **one** `edit` notification with
      `count` 3 and the newest time; after it is read, the next save makes a
      new one. A task tick by someone else tells followers like any edit.
      A save never changes when a notification is written: `pages.version`
      and `page_versions` are the same with and without followers.
- [x] Never from pages you can't see: Vi is told about a page in space R.
      After Vi is removed from R the list and the count drop it; after Vi is
      added back it returns. Trashing the page (or its parent, or the space)
      hides it from list and count; restoring brings it back; purging removes
      the rows. A deleted comment's notification is hidden. Count and list
      agree in every one of these states.
- [x] Only your own: another person's notification id in
      `POST /api/me/notifications/read` is ignored or 404, and nobody can list
      anyone else's. `{ all: true }` marks only yours. Paging with `before`
      gives each notification once, newest first.
- [x] Signed out → 401 on every route.
- [x] `npm run check` passes (this file is part of it).

---

### Lead acceptance of 15a (item #158, 2026-11-11)
Accepted. 15b may start.
- Read the #156 diff (`c6a2c4629`) myself against Decisions and Table changes:
  - The `mention` node is an inline atom in the one schema, with `userId` and
    `label`. Its HTML is `span[data-mention][data-user-id]`. A non-uuid id is
    a 400 through `checkEmbed`. `docMentions` lower-cases ids. Plain text
    shows `@label`.
  - Migration 0010 matches the table section column for column: the cascade
    and set-null rules, the kind check, `notifications_user_idx`, the partial
    unique `notifications_edit_unread_idx`, `page_follows` with its primary
    key and `page_follows_page_idx`. The snapshot and journal entry are there.
  - `onPageCreated`, `onPageSaved` and `onCommentPosted` run on the caller's
    `tx`, inside the same `db.transaction` as the page or comment row.
    `savePage` reads the old mentions under a row lock (`for update`) before
    it updates.
  - `notifications.ts` writes only `notifications` and `page_follows`. It
    never writes `pages` or `page_versions`.
  - The write rule (`canBeTold`): the person is active, is not the actor, the
    space is live, and the person is an instance admin, the space is open or
    they are a member. This is the same rule as `spacePeople`.
  - The read rule (`visibleTo`) is one function used by both the list and the
    unread count: the page is live and in `visibleSpaceIds(user)`, and a
    comment notification's comment is not deleted.
  - Follow routes use `requirePageRole(viewer)`, so there is one permission
    path and anyone who cannot read the page gets a 404.
  - Routes and shared types match the 15a list.
- Ran `npm run check` myself (Node 22): **exit 0**, all 7 steps ok, 77.5 s.
  Server 416 passed, including `notifications.test.ts` with 20 tests;
  editor-schema 31 passed. Load average went from about 8 to 6.2.
- Not a defect, noted for 15b: when an edit folds in, its `created_at` moves
  forward. A list opened earlier and paged with `before` can then miss that
  one row until it is reopened from the top. The panel should reload from the
  top when it opens.

## 15b — Screen

### Build
- [ ] Typing `@` in the editor (editors and up) opens a small list of people
      from `GET /api/spaces/:key/people?q=` that narrows as you type. Arrow
      keys, Enter and Tab pick, Escape closes and leaves the `@` as text.
      Picking puts a mention chip in the text. A chip shows the person's
      current name; one whose person cannot read the space shows "No access",
      an unknown id "Unknown person". `@` also appears in the slash menu as
      "Mention someone".
- [ ] A Follow / Following button on the page (for everyone who can read it,
      viewers included), next to the favourite star, shown at once and put
      back with a short quiet note if the server refuses.
- [ ] A bell in the top bar with the unread count (nothing shown at 0, "9+"
      above nine, a screen-reader label like "3 unread notifications"). It
      opens a panel listing notifications newest first in plain words
      ("Ana mentioned you on Pruning guide", "Ana commented on …", "Ana and
      others edited … (4 changes)"), unread ones marked softly, each linking
      to the page (a comment one opens the comments panel on that comment).
      Opening one marks it read; "Mark all as read" marks all; "Show more"
      pages back. An empty list says so plainly. All of it works by keyboard
      and the panel closes on Escape with focus back on the bell.
- [ ] Styles use only the design tokens. Light and dark both look right. Motion
      is soft and short and turns off under `prefers-reduced-motion`. Text and
      controls pass the contrast check (c6).
- [ ] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Check that must exist and pass — e2e (Playwright)
**Time cost of this feature's browser tests: at most one short test.** The
suite is near the checker's limit: with 25 tests the last timed runs were
82.08 s (lead, #152) and 122 s (coder, #154, at high load). Before 15b
starts, the tester makes three timed runs of the current 25-test suite and
writes them here, so the cost of the new test can be seen. Everything the
boxes in 15a prove stays proved by the server tests; the browser test only
proves what only a browser can. The test goes in a new
`e2e/tests/mentions.spec.ts`, which is file **18 of done-check 10's limit of
18** (export and page locks must add their tests to existing files). All
set-up (people, spaces, pages, follows, and every notification other than the
one made in the test) goes through the API in `e2e/login.ts`. The test must
take **at most 6 s** of test time in Playwright's per-test output.
- [x] Tester's baseline (item #157, Node 22): three timed `/usr/bin/time npm
      run test:e2e` runs of the current 25-test suite, before `mentions.spec.ts`
      is added, with load noted at the start and end of each.

      | run | exit | result | wall time | load at start | load at end |
      |-----|------|--------|-----------|----------------|--------------|
      | 1   | 0    | 25 passed | 1:04.96 (64.96s) | 2.00, 5.17, 7.43 | 7.56, 6.34, 7.69 |
      | 2   | 0    | 25 passed | 1:14.04 (74.04s) | 7.11, 6.27, 7.66 | 14.25, 8.72, 8.41 |
      | 3   | 0    | 25 passed | 1:14.80 (74.80s) | 13.75, 8.71, 8.41 | 16.08, 10.50, 9.05 |

      All three runs passed with exit 0, no retries, no skips. Middle run
      (sorted by wall time: 64.96s, 74.04s, 74.80s) is 74.04s, well under the
      95 s limit this done-check sets for the run with `mentions.spec.ts`
      added. Load climbed across the three back-to-back runs (own CPU load,
      not an outside load spike) but none of them slowed past 75s, so the
      suite has headroom before the new test is added.

      Per-file time, summed when a file has more than one test (seconds, runs 1 / 2 / 3):

      | file | run 1 | run 2 | run 3 | tests |
      |------|-------|-------|-------|-------|
      | ai.spec.ts | 11.2 | 9.0 | 10.3 | 2 |
      | ai-off.spec.ts | 5.0 | 4.5 | 4.5 | 1 |
      | comments.spec.ts | 9.2 | 8.8 | 9.0 | 1 |
      | editor.spec.ts | 20.9 | 27.5 | 25.6 | 2 |
      | editor-conflict.spec.ts | 8.1 | 7.8 | 8.4 | 1 |
      | embeds.spec.ts | 22.1 | 26.0 | 24.8 | 2 |
      | favourites.spec.ts | 6.3 | 10.5 | 6.7 | 1 |
      | history.spec.ts | 13.9 | 19.4 | 16.7 | 2 |
      | labels.spec.ts | 4.5 | 6.1 | 6.2 | 1 |
      | permissions.spec.ts | 5.6 | 7.4 | 7.2 | 1 |
      | search.spec.ts | 8.3 | 9.5 | 10.4 | 1 |
      | tasks.spec.ts | 13.3 | 15.3 | 14.2 | 2 |
      | templates.spec.ts | 11.2 | 14.1 | 15.4 | 2 |
      | trash.spec.ts | 12.0 | 14.5 | 14.9 | 2 |
      | video-links.spec.ts | 12.9 | 16.3 | 17.9 | 1 |
      | viewer.spec.ts | 4.2 | 4.4 | 6.0 | 1 |
      | wiki.spec.ts | 9.6 | 12.4 | 11.9 | 2 |

      Raw logs kept at `/tmp/e2e_run1.log`, `/tmp/e2e_run2.log`,
      `/tmp/e2e_run3.log` on this machine (not committed; outside the
      workspace's git repo).
- [ ] One test: an editor types `@` in a page, picks a viewer from the list
      and sees the chip; the page saves. The viewer (a second browser
      context) sees the bell count 1, opens the panel, sees "… mentioned you
      on …", clicks it and lands on the page; the count is gone. The viewer
      presses Follow and sees Following.
- [ ] `npm run test:e2e` passes in full: 25 + 1 = 26 tests, no retries, no
      skips, no `.only`.
- [ ] Time, under done-check 10's rule as rewritten in item #147: at least
      three timed `/usr/bin/time npm run test:e2e` runs by the tester with
      `mentions.spec.ts` in the suite, load noted at the start and end of
      each, **every run passes with exit 0 and the middle run is under 95 s**.
      The slowest runs are listed against the checker's ~110 s limit, and the
      mentions test's own time is written down. If the middle run is 95 s or
      more, or any run fails, the box stays open and the mentions test is cut
      back first; no limit is raised and no other test is dropped to make
      room.

---

## Hand check (lead, in a browser, both themes)
- [ ] As admin: two spaces (one restricted) with an editor, a viewer and a
      person who is not in the restricted space.
- [ ] As the editor in the restricted space: `@` lists only people who can see
      it (the outsider never appears, typed or not), by mouse and by keyboard;
      Escape leaves plain `@`. A pasted mention of the outsider saves and
      shows "No access", and the outsider is never told.
- [ ] As the viewer: the bell shows the mention; edits by the editor on a
      followed page fold into one line with a count; a comment shows its own
      line and opens on the comment. Mark all as read clears the count. The
      viewer cannot add a mention (cannot edit) but can follow and unfollow.
- [ ] Trash the page: its notifications leave the list and the count at once;
      restore brings them back. Remove the viewer from the space: the same.
- [ ] A second tab with the page open saves with no conflict note after
      someone followed or was told (follows and notifications never touch the
      page's version).
- [ ] Light and dark: calm, spaced out, no harsh colours; the count badge is
      soft, not alarming. Motion is quiet, and with reduced motion turned on
      it is instant.

## Lead check
- [ ] Read the diff myself: the node, tables and routes match the Decisions
      and Table changes sections; there is one permission path; notifications
      are written in the same transaction as the save or comment; no
      notification or follow code writes `pages` or `page_versions`; every
      read filters live pages in `visibleSpaceIds`, and the count and the list
      share one filter.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself, timed: all passed, exit 0, count, time
      and load noted here, and my run is added to the time record above.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` and pushed to GitHub, as the owner asked. If the
      workspace still has no GitHub remote, this box stays open and the lead
      says so in the team chat; export does not start until the owner has
      answered.
- [ ] ARCHITECTURE.md gets a short "Mentions, following and notifications"
      section: a mention is a person id in the doc like a task assignee;
      notifications are written in the save's or comment's transaction and
      filtered when read by live pages and `visibleSpaceIds`; edits fold; and
      why this keeps co-editing possible.
