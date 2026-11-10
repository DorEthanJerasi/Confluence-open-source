# Done-check 11: trash

Owner of this check: Wiki Lead. Written 2026-11-10 (item #129).
This is feature 1 of 3 in the order the owner approved (option a): **trash**,
then task lists, then labels. Task lists do not start until every box below is
ticked, the work is committed, and `npm run check` and `npm run test:e2e` pass.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **11a** server: migration, trash logic, routes, the timed purge, API tests.
- **11b** screen: Trash view in each space, trashed spaces, wording, e2e.

11b starts only after the lead has accepted 11a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it):
- Deleting a page already soft-deletes it and every page under it
  (`deletePage` in `apps/server/src/pages/pages.ts` sets `pages.deleted_at`).
  `requirePageRole` gives 404 for a soft-deleted page, so its comments and
  history routes already give 404. Search (`search/search.ts`) and AI retrieval
  (`ai/retrieve.ts`) already skip deleted pages and pages under a deleted page.
  Favourites and recently viewed filter on `pages.deleted_at` when read.
- Deleting a space is **for good today** (`DELETE /api/spaces/:key` deletes the
  row and everything cascades). This feature changes that to the trash.
- `visibleSpaceIds(user)` and `requireSpaceRole` / `requireSpaceByKey` in
  `apps/server/src/auth/permissions.ts` are the one permission path.
- Files: `attachments` rows point at a page and a space. The bytes are in
  `FileStorage` (`files/storage.ts`, which has `delete(key)`).
- **A gap this feature closes:** `readableAttachment` in
  `files/attachments.ts` checks only the space, so a file on a deleted page can
  still be downloaded today by anyone who can read the space.

---

## Decisions (the lead's, fixed for this feature)

- **Trash is a state of the same rows, never a copy.** A page or space in the
  trash keeps its row and its id. Its sub-pages, page history
  (`page_versions`), comments, attachments (rows and bytes), favourites and
  views are not touched when it is trashed and are all there again when it is
  restored. Nothing is copied, renumbered or given a new id. `pages.doc`,
  `pages.version`, `pages.ydoc_state` and `page_versions` are not changed by
  trash, restore or the move back into the tree. So co-editing can still be
  added later: a restored page is the same document with the same id.
- **One trash item = one delete.** When someone deletes a page, that page is the
  *trash root*. It and every live page under it get the same `deleted_at`,
  `deleted_by` and `trash_root_id` (the root's id). Restore and purge work on a
  whole item, found by `trash_root_id`. A sub-page that was deleted earlier on
  its own is its own item: restoring the parent does not bring it back.
- **A live page never sits under a trashed page.** Restoring a page puts it back
  under its old parent if that parent is live. If the parent is in the trash
  or gone, it goes to the top level of the space. It keeps its old position key
  unless a live sibling already has that key, then it goes at the end.
- **Spaces.** Deleting a space sets `spaces.deleted_at` and `deleted_by`. Its
  pages are not changed (page-level trash items inside it stay as they are). A
  trashed space is hidden everywhere: `visibleSpaceIds` and the space loaders
  treat it as not there (404), so its pages, files, comments, history,
  templates, search hits, AI sources, favourites and recent views all go with
  it. Its key stays taken while it is in the trash: making a new space with
  that key gives 409 "A space in the trash uses this key".
- **Who can do what** (role = the user's effective role in the space, from the
  existing permission path; there is no second rule):

  | action | viewer | editor | space admin / instance admin |
  |---|---|---|---|
  | delete a page (to the trash) | no (403) | yes | yes |
  | see the space's Trash view | no (403) | yes | yes |
  | restore a page | no (403) | yes | yes |
  | purge a page for good, empty the trash | no (403) | no (403) | yes |
  | delete a space (to the trash) | no | no | yes |
  | see, restore or purge a trashed space | no | no | yes |

  Someone who cannot read the space gets **404** on every trash route, the same
  as for the space itself. Purging is space-admin only because it cannot be
  undone and may remove other people's work.
- **Purge for good.** By hand: a space admin purges one item, or empties the
  whole space's trash. By time: an item is purged automatically
  `TRASH_RETENTION_DAYS` after it was trashed (env, default **30**; `0` means
  never). The sweep runs once when the server starts and then every hour, inside
  the server process (no extra service). Purging deletes the rows (the existing
  cascades remove sub-pages, history, comments, attachment rows, favourites and
  views) **and** deletes each attachment's bytes from `FileStorage`. Purging a
  page also purges any earlier trash items under it. A purged id is never
  reused.
- **Not in this feature:** trash for single comments, templates or files; picking
  where to restore to; restoring one sub-page out of a bigger item; trash
  notifications; showing trashed pages in search or AI answers (never).

## Table changes (migration `0007_trash`, runs on start like the others)

`pages` gains:
`deleted_by` uuid null → `users.id` on delete set null ·
`trash_root_id` uuid null (no foreign key; set only while `deleted_at` is set).
Index `pages_trash_idx` on `(space_id, trash_root_id)` where `deleted_at is not null`.

`spaces` gains:
`deleted_at` timestamptz null ·
`deleted_by` uuid null → `users.id` on delete set null.

Back-fill in the same migration: every page that is already soft-deleted gets a
`trash_root_id`: its topmost deleted ancestor with the same `deleted_at`, or
itself. So every old delete shows up as exactly one trash item.

---

## 11a — Server

### Build
- [ ] Drizzle columns in `apps/server/src/db/schema.ts` and migration
      `apps/server/drizzle/0007_trash.sql` (with its meta snapshot), exactly as
      in the Table changes section, back-fill included.
- [ ] `apps/server/src/trash/trash.ts` holds all trash logic: trash a page,
      list, restore, purge one, empty, purge expired, and the same for spaces.
      Access goes through the existing permission path. Restore and purge use a
      trash-aware page/space lookup that still takes the role from
      `effectiveRole`; no second permission rule.
- [ ] `deletePage` sets `deleted_at`, `deleted_by` and `trash_root_id` on the
      root and its live sub-pages in one statement.
- [ ] `visibleSpaceIds`, `requireSpaceRole` and `requireSpaceByKey` leave out
      trashed spaces. The spaces list leaves them out.
- [ ] `readableAttachment` gives 404 for a file whose page is trashed or sits
      under a trashed page, or whose space is trashed. Uploading to such a page
      is already 404 through `requirePageRole`.
- [ ] Routes (signed out → 401 on all of them):
  - `GET /api/spaces/:key/trash` (editor and up) returns
    `{ retentionDays, items: [{ id, title, deletedAt, deletedBy: { id, name } |
    null, subPages, purgeAt | null }] }`, newest first. Only trash roots are
    listed. `subPages` is the number of other pages in that item. `purgeAt` is
    null when `retentionDays` is 0.
  - `POST /api/pages/:id/restore` (editor and up) brings the whole item back and
    returns `{ page: { id, parentId, title } }`. A page that is live, or is in
    the trash but not a root, gives 400. A missing page gives 404.
  - `DELETE /api/pages/:id/purge` (space admin) purges one item, 204. A live page
    gives 400 ("Move it to the trash first"). Not a root gives 400.
  - `DELETE /api/spaces/:key/trash` (space admin) empties the space's trash.
    Returns `{ purged: n }`.
  - `DELETE /api/spaces/:key` (space admin) now moves the space to the trash, 204.
  - `GET /api/trash/spaces` returns `{ items: [{ id, key, name, deletedAt,
    deletedBy, purgeAt }] }`: trashed spaces where the user is a space admin, or
    all of them for an instance admin. Others get an empty list.
  - `POST /api/trash/spaces/:id/restore` and `DELETE /api/trash/spaces/:id`
    (space admin of that space or instance admin; others 404). By id, not key,
    because the space is hidden.
- [ ] `TRASH_RETENTION_DAYS` is read in `env.ts`, written into `.env.example`
      and `docker-compose.yml` with a one-line comment, and documented in
      INSTALL.md. A bad value (not a whole number ≥ 0) stops the server with a
      plain message.
- [ ] `purgeExpired(db, storage, now)` is exported, so the test can call it with
      a chosen time. The hourly timer calls it and is stopped when the server
      closes (tests do not hang).
- [ ] No trash code writes `pages.doc`, `pages.version`, `pages.ydoc_state` or
      `page_versions`.

### Checks that must exist and pass — `apps/server/test/trash.test.ts` (Vitest, real Postgres)
- [ ] An editor deletes a page with two levels of sub-pages, a history of 3
      versions, 2 comment threads and an attachment. The Trash list shows one
      item with `subPages: 2`, `deletedBy` the editor, and a `purgeAt` 30 days on.
- [ ] While it is in the trash: the page, a sub-page, its comments, its history
      and its file all give 404. Search for a word that is only in a sub-page
      finds nothing. AI ask (stub) does not use it as a source. It is not in
      favourites or recently viewed of a person who had it there.
- [ ] Restore by an editor: the same page ids come back under the same parent,
      in the same place. The version count, `pages.version`, the doc, the
      comments (ids and bodies) and the file bytes are unchanged. Search, AI
      sources, favourites and recent show it again.
- [ ] A sub-page deleted on its own first, then its parent deleted: two items.
      Restoring the parent leaves the sub-page in the trash. Restoring the
      sub-page after that puts it back under the parent.
- [ ] Restoring a page whose parent is still in the trash puts it at the top
      level, and the tree has no live page under a trashed one.
- [ ] Viewer: 403 on the Trash list, restore, purge and empty, and 403 on
      deleting a page. Editor: 403 on purge and empty. Non-member of a
      restricted space: 404 on all trash routes.
- [ ] Purge by a space admin: the page rows, version rows, comment rows and
      attachment rows are gone and the file's bytes are gone from storage.
      Purging a live page gives 400. Empty trash purges every item and returns
      the count.
- [ ] `purgeExpired` with `now` 29 days on leaves the item. At 31 days it purges
      it, bytes included. With `TRASH_RETENTION_DAYS=0` nothing is ever purged
      and `purgeAt` is null.
- [ ] Space: an admin deletes a space. It leaves the spaces list, its pages and
      files give 404, its pages leave search and AI sources, and a new space with
      the same key gives 409. It shows in `GET /api/trash/spaces` for its
      space admin and an instance admin, not for an editor of it. Restore brings
      it back with every page, page-level trash item, member and template as
      before. Purge removes it and its file bytes.
- [ ] The back-fill: a page and sub-page soft-deleted the old way (no
      `trash_root_id`) show up as one trash item after the migration.
- [ ] Signed out → 401 on every route.
- [ ] Existing tests that expected a space to be deleted for good (for example
      in `spaces.test.ts`) are changed to the trash rule, not deleted.
- [ ] `npm run check` passes (this file is part of it).

---

## 11b — Screen

### Build
- [ ] A quiet **Trash** link at the bottom of the space's page tree, shown to
      editors and up only (a viewer never sees it). It opens the space's Trash
      view at `/s/:key/trash`.
- [ ] The Trash view lists each item: title, "and n sub-pages" when there are
      any, who deleted it, `timeAgo` with `exactTime` on hover, and "Deleted for
      good in n days" (left out when retention is 0). Each item has
      **Restore**. Space admins also see **Delete for good** on each item and
      **Empty trash** at the top, both behind a quiet confirm that says it
      cannot be undone. An empty trash shows a calm empty state.
- [ ] After Restore the item fades out of the list, the page is back in the tree
      and a short note links to it.
- [ ] Wording on delete changes from "for good" to the trash: the page delete
      confirm says it moves the page and its n sub-pages to the trash and how
      long they are kept. The space delete in Space settings says the same and
      its button reads "Move to trash".
- [ ] Trashed spaces: instance admins and space admins see a "Deleted spaces"
      section (on the spaces screen or under Trash, the designer picks) with
      Restore and Delete for good, the same as pages.
- [ ] Opening the link of a trashed page shows the normal "Nothing here" page.
      For an editor and up it adds a line "This page is in the trash" with a
      link to the Trash view. Viewers see only "Nothing here".
- [ ] Styles use only the design tokens. Light and dark both look right. Motion
      is soft and short and turns off under `prefers-reduced-motion`. Text and
      controls pass the contrast check (c6).
- [ ] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Checks that must exist and pass — `e2e/tests/trash.spec.ts` (Playwright)
Set-up (people, space, a page with a sub-page) goes through the API helpers in
`e2e/login.ts`. **At most 2 tests**, and the suite stays inside the limits of
done-check 10: at most 18 files, and `npm run test:e2e` under 95 s at load 15
or more.
- [ ] An editor deletes the page from the tree. It leaves the tree, the Trash
      view shows it with "and 1 sub-page", and Restore puts both back in the
      tree with the same address (same id in the URL). Checked once in dark mode.
- [ ] A space admin empties the trash after a confirm, and the page link then
      shows "Nothing here". A viewer of the same space sees no Trash link, and
      `/s/:key/trash` shows that they cannot see it.
- [ ] `npm run test:e2e` passes in full: 19 + the new tests, no retries, no
      skips, no `.only`.

---

## Hand check (lead, in a browser, both themes)
- [ ] As admin: make a space with a page tree, history, comments, an image and
      a file. Make one person an editor and one a viewer.
- [ ] As the editor: delete a page with sub-pages. Check that search, Ask (stub)
      and Home no longer show it, and the file link gives 404. Restore it from
      Trash: the tree, the history, the comments and the image are all as
      before, with the same address.
- [ ] As the viewer: no Trash link, no way to restore, and the trashed page's
      link shows only "Nothing here".
- [ ] As admin: delete for good one item, then empty the trash. Delete the
      space, find it under deleted spaces, restore it, then delete it for good.
- [ ] Light and dark: calm, spaced out, no harsh colours. List motion is quiet,
      and with reduced motion turned on it is instant.

## Lead check (before task lists start)
- [ ] Read the diff myself: the columns and routes match the Decisions and
      Table changes sections, there is one permission path, no trash code
      writes the page document or history, and purge removes file bytes.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself: all passed, exit 0, count and time noted
      here.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` (pushing is done from outside the workspace, as
      the owner said).
- [ ] ARCHITECTURE.md gets a short "Trash" section: one item per delete
      (`trash_root_id`), rows kept with their ids, the purge rule, and why this
      keeps co-editing possible.
