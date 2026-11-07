# Done-check 07: page comments

Owner of this check: Wiki Lead. Written 2026-11-08 (item #104).
This is feature 1 of 3 in the order the owner picked (option b): **comments**,
then page templates (08), then favourites and recently viewed (09). Templates
do not start until every box below is ticked, the work is committed, and
`npm run check` and `npm run test:e2e` pass.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **7a** server: table, migration, routes, API tests.
- **7b** screen: comments panel, block markers, e2e.

7b starts only after the lead has accepted 7a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it): every top-level block in `pages.doc`
has a stable UUID in `attrs.id` (ARCHITECTURE.md §3 rule 2, filled in by the
editor-schema package). `requirePageRole(db, user, pageId, role)` in
`apps/server/src/pages/pages.ts` gives 404 for missing, deleted and not-visible
pages. The `minRole` and `roleAtLeast` helpers are in `@stillwater/shared`. The
e2e set-up helpers (`signUp`, `createSpace`, `createPage`, `addPerson`) are in
`e2e/login.ts`. `timeAgo` and `exactTime` are in `apps/web/src/time.ts`.

---

## Decisions (the lead's, fixed for this feature)

- **Comments live in their own table, never inside the page document.**
  `pages.doc` and `page_versions` are not changed by any comment action. So when
  co-editing comes, the Yjs document holds only page content and comments need
  no change. Restoring an old version does not delete or change comments.
- **Anchors are block ids, not positions.** A comment is either on the whole
  page (`block_id` null) or on one top-level block (`block_id` = that block's
  `attrs.id`). Ids do not shift when text is typed above them, so concurrent
  edits cannot move a comment to the wrong place. There are no character
  offsets and no marks in the document.
- **Stable ids.** Every comment has a server-made UUID that never changes and is
  never reused. Edit, resolve and delete keep the same id.
- **One level of replies.** A thread is a root comment (`parent_id` null) plus
  replies whose `parent_id` is that root. A reply to a reply is refused (400).
  Replies take the root's `block_id`.
- **Who can do what** (the role is the user's effective role in the space, from
  `requirePageRole`):

  | action | viewer | editor | space admin / instance admin |
  |---|---|---|---|
  | read comments | yes | yes | yes |
  | start a thread, reply | yes | yes | yes |
  | edit a comment | own only | own only | own only |
  | delete a comment | own only | own only | own and anyone's |
  | resolve / reopen a thread | no (403) | yes | yes |

  Someone who cannot read the page gets **404** on every comment route, the same
  as for the page itself. Viewers may comment because a comment is not an edit to
  the page. Their read-only page rule still holds.
- **Deleting is a soft delete** (`deleted_at`). A deleted root that still has
  live replies stays as "Comment deleted" (no body, no author) so the replies
  keep their place. A deleted root with no live replies, and a deleted reply, are
  not returned at all. The body is cleared in the database on delete.
- **Plain text only.** The body is trimmed, 1 to 4,000 characters, stored as
  text and always shown as text, never as HTML. Line breaks are kept.
- **A block that is gone.** If a thread's block is no longer in the current page,
  the thread still shows in the panel, marked "on a removed block". It is never
  lost.
- **Not in this feature:** live updates of other people's comments (the panel
  reloads when opened and after your own actions), @mentions, notifications,
  reactions, rich text, comments in search or AI answers.

## Table (migration `0004_page_comments`, runs on start like the others)

`page_comments`:
`id` uuid pk default `gen_random_uuid()` ·
`page_id` uuid not null → `pages.id` on delete cascade ·
`parent_id` uuid null → `page_comments.id` on delete cascade ·
`block_id` text null ·
`author_id` uuid null → `users.id` on delete set null ·
`body` text not null default `''` ·
`created_at` timestamptz not null default now() ·
`edited_at` timestamptz null ·
`resolved_at` timestamptz null, `resolved_by` uuid null → `users.id` on delete
set null (only set on roots) ·
`deleted_at` timestamptz null.
Index `page_comments_page_idx` on `(page_id, created_at)`.
A check constraint stops a row being both a reply and resolved
(`parent_id is null or resolved_at is null`).

---

## 7a — Server

### Build
- [x] Drizzle table `pageComments` in `apps/server/src/db/schema.ts` and
      migration `apps/server/drizzle/0004_page_comments.sql` (with its meta
      snapshot), exactly as in the Table section.
- [x] `apps/server/src/comments/comments.ts` holds all comment logic. Every
      function checks access through `requirePageRole`. There is no second
      permission rule.
- [x] Routes (signed out → 401 on all of them):
  - `GET /api/pages/:id/comments` returns
    `{ threads: [{ id, blockId, body, author: { id, name } | null, createdAt,
    editedAt, resolvedAt, resolvedBy: { id, name } | null, deleted,
    blockMissing, replies: [{ id, body, author, createdAt, editedAt }] }] }`.
    Open threads come first, oldest first. Resolved threads come after, newest
    resolved first. `blockMissing` is true when `blockId` is not a top-level
    block id of the current `pages.doc`.
  - `POST /api/pages/:id/comments` with `{ body, blockId?, parentId? }`
    returns 201 and the new comment. A `blockId` that is not a top-level block
    of the current page gives 400. A `parentId` that is not a live root of
    **this** page gives 400, and so does a `parentId` that is a reply.
    `blockId` with `parentId` is ignored (the root's is used).
  - `PATCH /api/comments/:id` with `{ body }`: author only (403 for others),
    sets `edited_at`. A deleted comment gives 404.
  - `DELETE /api/comments/:id`: the author or a space admin (403 for others).
    Returns 204.
  - `POST /api/comments/:id/resolve` and `/reopen`: editor and up (403 for a
    viewer), roots only (400 for a reply). Resolve sets `resolved_at` and
    `resolved_by`, and reopen clears them. Doing it twice is fine (200, no
    change).
  - `/api/comments/:id` routes find the page from the comment and then check
    access as above. A comment on a page the user cannot read, or on a deleted
    page, gives 404.
- [x] Bodies are checked as in Decisions: empty or only spaces gives 400, more
      than 4,000 characters gives 400. Unknown fields are refused.
- [x] No comment route writes `pages`, `page_versions` or `pages.version`.

### Checks that must exist and pass — `apps/server/test/comments.test.ts` (Vitest, real Postgres)
- [x] Editor starts a page comment and a block comment. GET returns both, with
      the right `blockId`, author and times.
- [x] Viewer of the space replies to a thread and starts one of their own.
- [x] Reply to a reply → 400. Reply naming a root from another page → 400.
      `blockId` not in the page → 400.
- [x] Edit: the author can (sets `editedAt`). Another editor and a space admin get 403.
- [x] Delete: the author can. A space admin can delete someone else's comment. An
      editor deleting someone else's gets 403. A deleted root with replies comes
      back as `deleted: true` with no body and no author. With no replies it is
      gone. The body is empty in the database afterwards.
- [x] Resolve and reopen: an editor can. A viewer gets 403. Resolving a reply
      gives 400. Resolved threads sort after open ones.
- [x] Non-member of a restricted space: 404 on GET, POST, PATCH, DELETE,
      resolve. After they are added as a viewer, GET works. After they are
      removed, 404 again.
- [x] Deleted page: 404 on its comments. Page deleted for real (cascade): its
      comments rows are gone.
- [x] Block removed from the page by a later save: the thread is still returned
      with `blockMissing: true`.
- [x] A comment body of `<img src=x onerror=alert(1)>` comes back as the same text.
- [x] Adding, editing, resolving and deleting comments leaves `pages.version`,
      `pages.doc` and the `page_versions` row count unchanged. Restoring an
      older version leaves the comments unchanged.
- [x] Signed out → 401 on every route.
- [x] `npm run check` passes (this file is part of it).

---

## 7b — Screen

### Build
- [ ] A **Comments** button in the page header, next to History, showing the
      number of open threads (no number when 0). It opens a side panel that
      slides in the same way the history panel does. Only one of the two is
      open at a time.
- [ ] The panel lists open threads, then a quiet "Resolved (n)" row that
      expands. Each thread shows the author, `timeAgo` with `exactTime` on hover,
      the body as plain text, "edited" when edited, and its replies indented one
      step. Block threads show a short quote of the block's first line, and
      clicking it scrolls to the block and briefly highlights it. Threads on a
      removed block say so.
- [ ] A box at the bottom of the panel to comment on the whole page.
      `Ctrl+Enter` / `⌘Enter` sends. Empty text cannot be sent.
- [ ] Block comments: hovering or focusing a top-level block shows a small
      comment button in the margin, which opens the composer for that block.
      Blocks with open threads show a quiet marker in the margin, and clicking
      it opens the panel at that thread. This works in read-only mode too, so
      viewers can comment. The marker and button are not part of the document
      (no change to `pages.doc` and no autosave).
- [ ] Controls follow the role table: Reply for everyone who can read. Edit
      for the author only. Delete for the author and space admins, with a quiet
      confirm. Resolve and Reopen for editors and up. A viewer never sees
      Resolve. A control you cannot use is not shown at all.
- [x] Styles use only the design tokens (no raw colours, sizes or timings in the
      new CSS). Light and dark both look right. Motion is soft and short and
      turns off under `prefers-reduced-motion`. Text and controls pass the
      contrast check (c6).
- [ ] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Checks that must exist and pass — `e2e/tests/comments.spec.ts` (Playwright)
Set-up (people, space, page with two paragraphs) goes through the API helpers
in `e2e/login.ts`. At most 3 tests, so the suite's time barely grows.
- [ ] An editor comments on the second paragraph and on the page. The marker
      appears on that block, and the count on the Comments button is 2. After a
      reload both are still there.
- [ ] A viewer of the space opens the page, sees both threads, replies to the
      block thread and sees no Resolve, Edit or Delete on the editor's comments.
      The editor then resolves that thread. It moves under "Resolved", the
      block marker goes, and the count drops to 1. Reopen brings it back.
- [ ] The author edits their own comment (shows "edited") and deletes it. A
      deleted root with a reply shows "Comment deleted" with the reply still
      under it. This is also checked once in dark mode.
- [ ] `npm run test:e2e` passes in full: 32 + the new tests, no retries, no skips,
      no `.only`.

---

## Hand check (lead, in a browser, both themes)
- [ ] Sign up as admin, make a second person a viewer of a restricted space and
      a third person a non-member. As admin: comment on a block and on the page,
      reply, edit, resolve, reopen, delete.
- [ ] As the viewer: can read and reply, cannot resolve, cannot edit others'
      comments.
- [ ] As the non-member: the page and its comments are not reachable (404 page).
- [ ] Type above a commented block, save, reload: the marker is still on the
      same block. Delete the block: the thread shows "on a removed block".
- [ ] Restore an older version from History: comments are unchanged.
- [ ] Light and dark: calm, spaced out, no harsh colours. The panel motion is
      quiet, and with reduced motion turned on it is instant.

## Lead check (before templates start)
- [ ] Read the diff myself: the comment table and routes match the Decisions
      and Table sections, there is one permission path (`requirePageRole`), and
      no comment code writes the page document.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself: all passed, exit 0, count noted here.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` (pushing is done from outside the workspace, as
      the owner said).
- [ ] ARCHITECTURE.md gets a short "Comments" section: the table, block-id
      anchors, and why it stays out of the Yjs document.
