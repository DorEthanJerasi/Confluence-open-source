# Done-check 13: labels

Owner of this check: Wiki Lead. Written 2026-11-11 (item #148).
This is feature 3 of 3 in the order the owner approved (option a): trash
(signed off, #133), task lists (signed off, #147), then **labels**. Labels are
done only when every box below is ticked, the work is committed, and
`npm run check` and `npm run test:e2e` pass with exit 0.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **13a** server: the two tables, the label rules, the routes, the label
  filter in search, API tests.
- **13b** screen: labels under the page title, the two "pages with this label"
  views, the label filter on the search screen, the one e2e test.

13b starts only after the lead has accepted 13a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it):
- `visibleSpaceIds(user)`, `effectiveRole`, `requireSpaceRole`,
  `requireSpaceByKey` and `requirePageRole` in
  `apps/server/src/auth/permissions.ts` and `pages/pages.ts` are the one
  permission path. A trashed page, a page under a trashed page, and every page
  in a trashed space are already 404 through them (done-check 11).
- `GET /api/pages/:id` (`getPageView` in `pages/pages.ts`) returns the page
  with `myRole` and `favourite`; labels are added to that same answer.
- Search is `GET /api/search?q=&limit=` (`routes/search.ts`,
  `search/search.ts`, `searchPages`). Its permission filter is in the SQL
  through `visibleSpaceIds`, and it already skips trashed pages
  (ARCHITECTURE.md §6). Labels add a filter to this query; there is no second
  search.
- Screens: `/search` (`SearchScreen.tsx`), a space at `/s/:key`, a page at
  `/s/:key/p/:pageId` (`PageScreen.tsx`), routes in `apps/web/src/App.tsx`.
- E2E set-up helpers in `e2e/login.ts`: `addPerson`, `createSpace`,
  `createPage`, `logIn`, `signUp`.

---

## Decisions (the lead's, fixed for this feature)

- **A label is a named tag on a page, kept beside the page, not inside its
  document.** Labels live in their own two tables (below), never in
  `pages.doc`. Adding or removing a label does **not** change `pages.doc`,
  `pages.version`, `pages.updated_at` or `page_versions`, and does not go
  through `savePage`. So an editor who has the page open never gets a save
  conflict because someone labelled it, and history restore leaves the
  current labels as they are (labels are not part of a version).
- **Stable ids.** Each label name is one row in `labels` with a uuid that never
  changes. A page's label is one row in `page_labels` keyed by
  `(page_id, label_id)`. Nothing is renumbered or copied; a page keeps its
  labels through moves, trash and restore. A label row stays when no page uses
  it any more (it is then hidden everywhere, see below), so the same name keeps
  the same id.
- **Add and remove are set operations.** Adding a label the page already has is
  a 200 with no change; removing one it does not have is a 200 with no change.
  Two people labelling at once can never clash, and no base version is needed.
  This is why co-editing can be added later without touching labels: they are
  outside the document, and set adds and removes merge in any order (the same
  shape a Yjs map of label ids would have, if they ever move into the doc).
- **One label list for the whole wiki.** Names are shared across spaces, so the
  whole-wiki view can gather every page with a label. The name rule (one
  shared function `normaliseLabel` in `packages/shared/src/index.ts`, used by
  the server and the screen): trim; lower-case; runs of spaces become one `-`;
  then only letters (any language), digits, `-` and `_` are allowed; 1 to 40
  characters. Anything else is a 400 with a plain message. At most **20 labels
  per page**; the 21st is a 400 "A page can have at most 20 labels".
- **Nobody sees a label or a page they could not open.** Every label read is
  filtered when it is read (not when the label is added): the page must be
  live (`pages.deleted_at` is null, so nothing in or under a trashed page) and
  in a space from `visibleSpaceIds(user)` (so never a trashed space or a space
  they cannot read now). The suggestion list only offers names that are on at
  least one page the user can see, and counts only those pages, so a label used
  only in a restricted space does not leak its name. A label view for a name
  that exists but has no page the user can see looks the same as one for a
  name that does not exist: 200 with no pages.
- **Trash.** Trash, restore and the timed purge do not touch `page_labels`.
  A trashed page's labels are hidden with it and are back when it is restored.
  Purge removes them by cascade. The `labels` rows stay.
- **Who can do what** (role = the user's effective role in the page's space,
  from the existing permission path; there is no second rule):

  | action | viewer | editor | space admin / instance admin |
  |---|---|---|---|
  | see a page's labels | yes | yes | yes |
  | add or remove a label on a page | no (403) | yes | yes |
  | open a per-space or whole-wiki label view | yes (only pages they can see) | yes | yes |
  | filter search by label | yes (only pages they can see) | yes | yes |

  Someone who cannot read the space gets **404** on the page's label routes,
  the same as for the page, and **404** on the per-space label view.
- **Search finds pages by label** in two ways, both through the one
  `searchPages` query: `GET /api/search` takes `label=` (repeatable; a page
  must have every label given), and the search box turns `label:name` words
  in the query into that filter. With a label and no other words, search lists
  the labelled pages by last change, newest first. Label names are **not**
  added to the full-text column (`pages.search` stays as it is), so no
  generated column changes.
- **Not in this feature:** label colours, renaming or merging labels, an admin
  screen for labels, labels on spaces, templates or comments, labels in AI
  answers or AI sources beyond the page text they already use, label
  "watching" or notifications, labels in page history.

## Table changes (migration `0009_labels`, runs on start like the others)

New table `labels`:
`id` uuid primary key default `gen_random_uuid()` ·
`name` text not null, unique (the normalised form) ·
`created_by` uuid null → `users.id` on delete set null ·
`created_at` timestamptz not null default now().

New table `page_labels`:
`page_id` uuid not null → `pages.id` on delete cascade ·
`label_id` uuid not null → `labels.id` on delete cascade ·
`added_by` uuid null → `users.id` on delete set null ·
`added_at` timestamptz not null default now().
Primary key `(page_id, label_id)`. Index `page_labels_label_idx` on
`(label_id)`.

No space column: the space is read from `pages` when filtering, so a page move
needs no extra code. No back-fill.

---

## 13a — Server

### Build
- [x] `normaliseLabel(raw): string | null` in `packages/shared/src/index.ts`,
      as in Decisions, and the shared request and response types for the
      routes below.
- [x] Drizzle tables in `apps/server/src/db/schema.ts` and migration
      `apps/server/drizzle/0009_labels.sql` (with its meta snapshot), exactly
      as in the Table changes section.
- [x] `apps/server/src/labels/labels.ts` holds the label logic and
      `apps/server/src/routes/labels.ts` the routes. Access goes through the
      existing permission path. No label code writes `pages`, `page_versions`
      or calls `savePage`.
- [x] Routes (signed out → 401 on all of them):
  - `GET /api/pages/:id` gains `labels: [{ id, name }]`, by name.
  - `POST /api/pages/:id/labels` with `{ name }` (editor and up) adds it
    (making the `labels` row if the name is new) and returns
    `{ labels: [{ id, name }] }`. Adding one the page has is 200, no change.
  - `DELETE /api/pages/:id/labels/:labelId` (editor and up) removes it and
    returns `{ labels }`. Removing one the page lacks is 200, no change.
  - `GET /api/labels?q=` returns `{ labels: [{ id, name, count }] }`: names
    on pages the user can see, `count` = how many such pages, names starting
    with `q` first, then by count, at most 50.
  - `GET /api/labels/:name/pages` (whole wiki) and
    `GET /api/spaces/:key/labels/:name/pages` (one space, viewer and up)
    return `{ label: { id, name } | null, pages: [{ id, title, space: { key,
    name }, updatedAt, labels: [{ id, name }] }], truncated }`: live pages
    the user can see that have the label, newest change first, at most 200,
    `truncated` true when there were more. `:name` goes through
    `normaliseLabel` first.
- [x] `GET /api/search` takes `label=` (repeatable) and reads `label:name`
      words in `q`, as in Decisions, inside `searchPages`. Each result gains
      `labels: [{ id, name }]`.

### Checks that must exist and pass — `apps/server/test/labels.test.ts` (Vitest, real Postgres)
- [x] `normaliseLabel`: `"  Team Notes "` → `team-notes`; `"Año_2026"` →
      `año_2026`; `""`, `"   "`, `"a/b"`, `"<b>"` and 41 characters → null.
- [x] An editor adds `design` and `q4-plans` to a page. `GET /api/pages/:id`
      lists both, by name. Adding `Design` again is 200 and the page still has
      two. Removing `design` leaves one; removing it again is 200. The 21st
      label is a 400 and nothing is added. A bad name is a 400.
- [x] Ids are stable: `design` added to a second page uses the same label id.
      After every page loses it, adding it again uses the same id.
- [x] Labels do not touch the page: after adding and removing labels,
      `pages.doc`, `pages.version`, `pages.updated_at` and the number of
      `page_versions` rows are unchanged, and a save with the old base version
      still succeeds (no 409). Restoring an older version keeps today's labels.
- [x] Roles: a viewer sees the labels and gets 403 on add and remove. A
      non-member of a restricted space gets 404 on add, remove and the page.
      An instance admin who is no member can add.
- [x] Label views: `design` on a page in open space A, one in restricted space
      R and one in space B. A member of A and B but not R gets two pages from
      the whole-wiki view and one from A's view; R's view is 404 for them; a
      member of R gets all three. `GET /api/labels` for the outsider has
      `design` with count 2, and a label used only in R is not listed at all.
      Its whole-wiki view gives 200 with `pages: []`, the same as a name that
      was never used.
- [x] Trash: moving a labelled page (or its parent) to the trash takes it out
      of both views, the counts and search; restore brings it back with its
      labels. Moving the space to the trash hides all its pages the same way.
      Purge removes the `page_labels` rows; the `labels` row stays.
- [x] Search: `?label=design` lists only labelled pages the user can see,
      newest first; `?q=budget&label=design` needs both; two `label=` need
      both labels; `q=label:design budget` gives the same as the second. A
      trashed or restricted page never shows. Results carry `labels`.
- [x] Order and limits: views are newest change first, at most 200, with
      `truncated`; suggestions put names starting with `q` first, at most 50.
- [x] Signed out → 401 on every route.
- [x] `npm run check` passes (this file is part of it).

Lead check of 13a (item #149, 2026-11-11): read the migration, labels.ts,
labelSql.ts, routes/labels.ts and the search change; no label code writes
`pages` or `page_versions`. `npm run check` run by the lead with Node 22:
exit 0, all 7 steps, 22 files, 396 tests, the 10 in labels.test.ts among them,
at load 11-15. Accepted; 13b may start.

---

## 13b — Screen

### Build
- [x] Under the page title, the page's labels show as small soft chips (for
      viewers too, read-only). Each chip opens the space's label view. Editors
      also get an "Add label" control: a small input with suggestions from
      `GET /api/labels?q=` that shows the normalised name as it is typed and
      the server's message when a name is refused, and a remove button on each
      chip. All of it works by keyboard (Enter adds, Backspace on an empty
      input moves to the last chip, each remove has a screen-reader label).
      Adding and removing show at once and are put back with a short quiet
      note if the server refuses.
- [x] The per-space label view at `/s/:key/labels/:name` lists the pages with
      title, last change and their other labels, each linking to the page,
      with a link "In all spaces" to the whole-wiki view at `/labels/:name`,
      which also shows each page's space. An empty view says plainly that no
      page you can see has this label. A truncated list says so.
- [x] The search screen takes `label:name` in the box and shows the active
      labels as removable chips; results show their labels. Clicking a label
      in a result adds it to the filter.
- [x] Styles use only the design tokens. Light and dark both look right. Motion
      is soft and short and turns off under `prefers-reduced-motion`. Text and
      controls pass the contrast check (c6).
- [x] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Check that must exist and pass — e2e (Playwright)
**Time cost of this feature's browser tests: at most one short test.** The e2e
suite has almost no time left: of the 13 runs recorded for task lists, the
middle one took 85.51 s and the slowest 110.56 s, against the checker's limit
of about 110 s. So everything the boxes in 13a prove is proved by the server
tests above, and the browser test only proves what only a browser can: the
chips, the Add label control and the views on screen. The test goes in a new
`e2e/tests/labels.spec.ts` (17 files, inside done-check 10's limit of 18). All
set-up (people, spaces, pages, and labels other than the one typed in the
test) goes through the API helpers in `e2e/login.ts`. The test must take
**at most 6 s** of test time in Playwright's per-test timing output.
- [x] One test: an editor opens a page, adds a label with the Add label
      control and sees its chip; opens the chip's space view and sees the page
      (and a second labelled page made through the API); "In all spaces"
      shows a page from a second space; the search screen with `label:` finds
      the page. A viewer is not part of this test (the server tests prove the
      403); dark mode is checked by hand, not here.
- [x] `npm run test:e2e` passes in full: 23 + 1 = 24 tests, no retries, no
      skips, no `.only`.
- [ ] Time, under done-check 10's rule as rewritten in item #147: at least
      three timed `/usr/bin/time npm run test:e2e` runs by the tester with
      `labels.spec.ts` in the suite, load noted at the start and end of each,
      **every run passes with exit 0 and the middle run is under 95 s**. The
      slowest runs are listed against the checker's ~110 s limit, and the
      labels test's own time from the per-test output is written down. If the
      middle run is 95 s or more, or any run fails, the box stays open and the
      labels test is cut back first; no limit is raised and no other test is
      dropped to make room.

Lead check of 13b (item #150, 2026-11-11): read PageLabels.tsx, LabelScreens.tsx,
labels.ts, the SearchScreen and PageScreen changes, labels.css (tokens only,
motion through the tokens.css reduced-motion rule) and the two new contrast
pairs. Remove buttons and Add label show only for editors and up; viewers get
read-only chips. Ran with Node 22: `npm run check` exit 0, all 7 steps, 396
tests (load 15-17); `/usr/bin/time npm run test:e2e` 24 passed, exit 0, no
retries, 65.86 s wall, load 12.6 at start and 14.1 at end, the labels test
5.2 s. 13b build and test boxes ticked; the timed-runs box (tester), the hand
check and the lead check below stay open.

---

## Hand check (lead, in a browser, both themes)
- [ ] As admin: make two spaces (one restricted) with an editor and a viewer,
      and a few pages in each.
- [ ] As the editor: add labels by mouse and by keyboard, with a capital and a
      space in the name (it becomes the normalised form), try a bad name and a
      21st label (plain message), remove one. Reload: the labels are still
      there. With the page open in another tab, editing there after the labels
      changed saves with no conflict note.
- [ ] The space view, the whole-wiki view and search with `label:` show the
      right pages. As the viewer: chips show, nothing can be added or removed,
      and a page in the restricted space never shows in any view, suggestion
      or count.
- [ ] Trash a labelled page: it leaves every view and search; restore it and
      it is back with its labels.
- [ ] Light and dark: calm, spaced out, no harsh colours. Motion is quiet, and
      with reduced motion turned on it is instant.

## Lead check (the last feature in the approved order)
- [ ] Read the diff myself: the tables and routes match the Decisions and
      Table changes sections, there is one permission path, no label code
      writes `pages` or `page_versions`, and every read filters live pages in
      `visibleSpaceIds`.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself, timed: all passed, exit 0, count, time
      and load noted here, and my run is added to the time record above.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` (pushing is done from outside the workspace, as
      the owner said).
- [ ] ARCHITECTURE.md gets a short "Labels" section: labels sit beside the doc
      in two tables with stable ids, add and remove are set operations that
      never touch the doc or its version, reads are filtered by
      `visibleSpaceIds` and live pages, and why this keeps co-editing
      possible.
