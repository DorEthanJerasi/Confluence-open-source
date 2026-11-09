# Done-check 09: favourites and recently viewed

Owner of this check: Wiki Lead. Written 2026-11-09 (loop #3).
This is feature 3 of 3 in the order the owner picked (option b): comments (07,
accepted), page templates (08, accepted on `f4c3c9a0`), then **favourites and
recently viewed**. Nothing else starts until every box below is ticked, the
work is committed, and `npm run check` and `npm run test:e2e` pass.

The work is split into **two items** so each fits in one run (big items have
timed out before):

- **9a** server: two tables, one migration, routes, API tests.
- **9b** screen: star on the page, two lists on Home, e2e.

9b starts only after the lead has accepted 9a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it): `requirePageRole(db, user, pageId,
role)` and `getPageView` in `apps/server/src/pages/pages.ts` (404 for a page
that is missing, soft-deleted or in a space the user cannot see).
`visibleSpaceIds(user)` in `apps/server/src/auth/permissions.ts` is the one
filter for every list. Pages are soft-deleted (`pages.deleted_at`); deleting a
space or a user cascades. The page header is in
`apps/web/src/screens/PageScreen.tsx`, Home is `apps/web/src/screens/Home.tsx`.
The e2e set-up helpers (`signUp`, `createSpace`, `createPage`, `addPerson`) are
in `e2e/login.ts`.

---

## Decisions (the lead's, fixed for this feature)

- **Both lists are personal.** Each person sees only their own favourites and
  their own recently viewed pages. Nobody, admins included, can see another
  person's lists, and no counts ("starred by 4 people") are shown anywhere.
- **Anyone who can read a page can favourite it**, viewers included: a
  favourite changes nothing in the space, only the person's own list. So the
  rule is `requirePageRole(..., 'viewer')`, and a page the user cannot see is
  **404**, the same as opening it.
- **Lists are filtered when read, not cleaned up when access changes.** Rows
  stay in the table; every list query joins `pages` and keeps only pages that
  are not deleted and whose space is in `visibleSpaceIds(user)`. So a person
  removed from a restricted space stops seeing its pages in both lists at
  once, and sees them again if they are added back. There is no second
  permission rule.
- **A view is recorded on purpose, not as a side effect of reading.**
  `GET /api/pages/:id` stays read-only. The page screen calls
  `POST /api/pages/:id/viewed` once each time a page is opened (not on
  autosave, refetch or window focus). That keeps history, AI, search and the
  template picker from filling the list with pages nobody opened.
- **One row per person and page for views**, updated in place (upsert of
  `viewed_at`). Each person keeps at most **50** view rows; the write that adds
  the 51st deletes their oldest in the same statement or transaction. The list
  shows the newest **20**.
- **Order.** Favourites: newest favourited first, at most 100 returned.
  Recently viewed: newest viewed first. Both give the page title, its space
  key and name, and the time. No page content is returned.
- **Favouriting is idempotent.** `PUT` on an existing favourite and `DELETE` on
  a missing one both give 204. No version numbers: there is nothing to
  conflict over.
- **Deleting.** A soft-deleted page drops out of both lists (filtered when
  read). Deleting a space or a user removes their rows (cascade through
  `pages` and `users`).
- **Not content.** Favourites and views are not in search, AI summaries, AI
  answers or page history, and they never change `pages.version` or
  `pages.updated_at`.
- **Ready for co-editing.** The rows hold only a user id, a page id and a time.
  They never touch the document or `pages.ydoc_state`, so co-editing needs no
  change here.
- **Words on screen.** "Favourites", "Add to favourites", "Remove from
  favourites", "Recently viewed", spelled as the owner spells them.
- **Not in this feature:** favourite spaces, folders or ordering of
  favourites, sharing lists, a "popular pages" list, view counts, email or
  notifications, a favourites section in the sidebar.

## Tables (migration `0006_favourites_views`, runs on start like the others)

`page_favourites`:
`user_id` uuid not null → `users.id` on delete cascade ·
`page_id` uuid not null → `pages.id` on delete cascade ·
`created_at` timestamptz not null default now().
Primary key `(user_id, page_id)`. Index `page_favourites_user_idx` on
`(user_id, created_at desc)`.

`page_views`:
`user_id` uuid not null → `users.id` on delete cascade ·
`page_id` uuid not null → `pages.id` on delete cascade ·
`viewed_at` timestamptz not null default now().
Primary key `(user_id, page_id)`. Index `page_views_user_idx` on
`(user_id, viewed_at desc)`.

---

## 9a — Server

### Build
- [x] Drizzle tables `pageFavourites` and `pageViews` in
      `apps/server/src/db/schema.ts` and migration
      `apps/server/drizzle/0006_favourites_views.sql` (with its meta snapshot),
      exactly as in the Tables section. `drizzle-kit generate` afterwards says
      there is nothing to migrate.
- [x] `apps/server/src/me/personal.ts` (or one file of that kind) holds all the
      logic. Page checks go through `requirePageRole`; lists filter with
      `visibleSpaceIds` and `pages.deleted_at is null`. No second permission
      rule.
- [x] Routes (signed out → 401 on all of them):
  - `PUT /api/pages/:id/favourite` → 204. `DELETE /api/pages/:id/favourite`
    → 204. A page the user cannot see, a deleted page or an unknown id → 404.
  - `POST /api/pages/:id/viewed` → 204, same 404 rule. Upserts `viewed_at`
    and keeps at most 50 rows for that person.
  - `GET /api/me/favourites` →
    `{ pages: [{ id, title, space: { key, name }, favouritedAt }] }`,
    newest first, at most 100.
  - `GET /api/me/recent` →
    `{ pages: [{ id, title, space: { key, name }, viewedAt }] }`,
    newest first, at most 20.
  - `GET /api/pages/:id` also returns `favourite: boolean` for the person
    asking. Nothing else in its answer changes.
- [x] Bodies on these routes are refused if they carry unknown fields (empty
      body expected).

### Checks that must exist and pass — `apps/server/test/personal.test.ts` (Vitest, real Postgres)
- [x] An editor favourites two pages in two spaces: both are listed, newest
      first, with title and space; `GET /api/pages/:id` says `favourite: true`
      for them and `false` for a third page.
- [x] `PUT` twice gives 204 twice and one row; `DELETE` removes it from the
      list; `DELETE` again gives 204.
- [x] A viewer of a space can favourite and record views there (204), and the
      page's `version` and `updated_at` are unchanged afterwards.
- [x] Another person's favourites and views never show in your lists, and an
      instance admin's lists hold only the admin's own.
- [x] Opening pages A, B, A (three `viewed` calls) lists A then B, with one row
      each. 55 `viewed` calls on 55 pages leave 50 rows for that person and
      the list shows the newest 20.
- [x] `GET /api/pages/:id` on its own does not add a view.
- [x] Non-member of a restricted space: `PUT favourite` and `viewed` give 404.
      A member who favourited and viewed a page there, then is removed from the
      space, no longer sees it in either list; added back, it shows again.
- [x] A soft-deleted page drops out of both lists, and its routes give 404.
      Deleting its space removes the rows (count the rows).
- [x] Deleting a user removes their rows.
- [x] A page titled `<img src=x onerror=alert(1)>` comes back as the same text.
- [x] Signed out → 401 on every route.
- [x] `npm run check` passes (this file is part of it).

### Lead acceptance of 9a (2026-11-09, loop #3 round 3)
Accepted. Checked in the workspace myself, not from the report:
- Read the diff of `2e218aed`: tables match the Tables section exactly (primary
  keys, cascades, the two `desc` indexes). Writes go through
  `requirePageRole(..., 'viewer')`; both lists join `pages` and filter with
  `pages.deleted_at is null` and `visibleSpaceIds(user)`; nothing writes
  `pages` or `page_versions`. The 50-row cap runs in the same transaction as
  the upsert. `GET /api/pages/:id` only gains `favourite`.
- `drizzle-kit generate`: "No schema changes, nothing to migrate".
- `vitest run test/personal.test.ts`: 13/13 passed, exit 0.
- `npm run check`: all 7 steps ok, 348 tests, exit 0, 4m33s wall.

**9b (screen) may start now.** It goes to the builder as one item: the star in
the page header, the one `viewed` call on open, the two Home sections, and
`e2e/tests/favourites.spec.ts` with at most 2 tests. Then designer (styles box),
tester (e2e run), and the lead's hand and lead checks.

---

## 9b — Screen

### Build
- [x] **Star on the page.** In the page header, next to History and Comments,
      a star button for everyone who can read the page (viewers too). Its
      label is "Add to favourites" or "Remove from favourites" and it has
      `aria-pressed`. It changes at once and goes back with a quiet note if the
      server refuses.
- [x] **View recorded on open.** Opening a page (from a link, the tree, search,
      Home or the address bar) calls `POST /api/pages/:id/viewed` once.
      Autosave, refetch and switching tabs do not.
- [x] **Home gets two quiet sections** above the list of spaces:
      "Favourites" and "Recently viewed", each showing up to 8 pages as
      title + space name + a soft relative time, each a link to the page. When
      a list is empty it says so in one calm line (for example "Star a page to
      keep it here.") instead of hiding the heading. Starring or unstarring a
      page updates Home without a reload.
- [x] Styles use only the design tokens (no raw colours, sizes or timings in
      the new CSS). Light and dark both look right. Motion is soft and short
      and turns off under `prefers-reduced-motion`. The star and the lists work
      with the keyboard alone and pass the contrast check (c6).
- [x] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Checks that must exist and pass — `e2e/tests/favourites.spec.ts` (Playwright)
Set-up (people, spaces, pages) goes through the API helpers in `e2e/login.ts`.
**At most 2 tests**: c2 has timed out in the outside checker before, so the
suite must not grow much.
- [x] An editor opens two pages, stars one, goes Home: the starred page is
      under "Favourites", both are under "Recently viewed" with the last one
      opened first. They unstar it from the page and Home shows the empty
      line. Checked once in dark mode.
- [x] A viewer of a restricted space stars a page there and sees it on Home;
      an admin removes them from the space; after a reload the page is gone
      from both of their lists.
- [x] `npm run test:e2e` passes in full: 38 + the new tests, no retries, no
      skips, no `.only`. The lead notes the wall-clock time and the load; it
      should stay under the 75 s target in `06-c2-time-budget.md`.

### Builder report for 9b (2026-11-09, loop #3 round 3)
Code is in `0cd27829` (the run that wrote it timed out before it could check it;
this note is the check, run by hand afterwards, Node 22). Boxes are left for the lead.
- Star: `FavouriteButton` in `apps/web/src/screens/PageScreen.tsx`, labels
  "Add to favourites" / "Remove from favourites", `aria-pressed`, changes at
  once, goes back with a quiet note ("Couldn't update favourites…") on refusal.
- View: one `POST /viewed` per `PageView` mount (keyed by page id), guarded by a
  ref; not on autosave, refetch or focus.
- Home (`apps/web/src/screens/Home.tsx`): "Favourites" and "Recently viewed"
  above Spaces, up to 8 rows each, calm empty lines. The nav link and heading now
  say "Home"; `e2e/tests/wiki.spec.ts` was scoped to the Spaces region to match.
- Styles: tokens only (`app.css`, end of file); reduced motion is covered by the
  global rule in `tokens.css`.
- `npm run typecheck`: exit 0. Originality scan: ORIGINAL OK. Contrast: 50 pairs OK.
- `playwright test tests/favourites.spec.ts`: 2 passed.
- `npm run test:e2e` in full: **40 passed** (38 + 2), retries 0, 2.0 min wall,
  machine load average 11 to 21 during the run. That is over the 75 s target in
  `06-c2-time-budget.md`; the load was high, so the lead should time it again.
- Dark-mode screenshot: `e2e/test-results/favourites-home-dark.png`, looked at: calm, readable.

### Designer's check of the styles box (2026-11-09, loop #3 round 3)
Checked in the workspace myself, not from the builder's report:
- `app.css` diff for this feature uses only `var(--space-*)`, `var(--motion-fast)`,
  `var(--ease-standard)` and `var(--color-accent)` — no raw colours, sizes or
  timings. `.btn-star` is a plain `.btn-quiet` with `.is-on` filling the star
  in the accent colour, the same pattern as History/Comments.
- `PersonalList` on Home reuses `.list` / `.list-link` / `.muted.small` /
  `.section-title`, each section has its own `aria-labelledby` heading, and
  the empty line sits in the list in place of the rows — no layout jump.
- Reduced motion needs no per-component rule: the new `.btn-star` and
  `.fade-in` transitions are caught by the single global
  `prefers-reduced-motion` block in `tokens.css` (lines 135-140).
- Ran `node scripts/check-original.mjs`: `ORIGINAL OK`.
- Ran `node scripts/check-contrast.mjs`: `CONTRAST OK`, 50 pairs, both themes.
- Ran `npm run typecheck --prefix apps/web`: exit 0.
- The star button and the two Home lists are plain `<button>` / `<Link>`
  elements with `aria-pressed` / visible focus from the shared `.btn` and
  `.list-link` styles, so keyboard-only use needs no new code.

---

## Hand check (lead, in a browser, both themes)
- [x] As an editor: star pages in two spaces from the page header, open
      several pages, go Home: both lists are right and in order. Unstar from
      the page: Home updates without a reload.
- [x] Keep a page open and let autosave run for a while: Recently viewed does
      not jump around.
- [x] As a viewer: the star is there and works. As a non-member: a page link
      in a restricted space is the 404 page, and nothing from it is in their
      lists.
- [x] Delete a starred page: it is gone from both lists.
- [x] Light and dark: the star and the two Home sections are calm, spaced out,
      no harsh colours; motion is quiet and instant with reduced motion on.
      Everything works with the keyboard alone.

## Lead check (closes the owner's option b)
- [x] Read the diff myself: tables and routes match the Decisions and Tables
      sections, page checks go through `requirePageRole`, lists filter with
      `visibleSpaceIds`, and nothing here writes `pages` or `page_versions`.
- [x] Ran `npm run check` myself: exit 0.
- [x] Ran `npm run test:e2e` myself: all passed, exit 0, count and wall time
      noted here.
- [x] Hand check above done and ticked.
- [x] Committed on `master` and pushed if the workspace can reach GitHub (if
      there is still no remote, say so plainly in the record).
- [x] ARCHITECTURE.md gets a short "Favourites and recently viewed" section:
      the two tables, filtering when read, the explicit `viewed` call, the
      50-row cap, and why co-editing needs no change. §12 gets a line pointing
      at this file.

### Lead sign-off (2026-11-10, work item #117)
Every box above is ticked from my own reading of the code and my own runs on
this machine (Node 22), not from the team's reports.

- **Code.** Read the 9b diff (`0cd27829`, against the 9a acceptance
  `8d4cc4f9`): `FavouriteButton` in `PageScreen.tsx` (labels, `aria-pressed`,
  changes at once, sends in order, goes back and shows a note on refusal);
  the single `recordView` effect guarded by a ref in `PageView`, which is
  rendered with `key={pageId}`, so one call per open; Home's two
  `PersonalList` sections with up to 8 rows and calm empty lines, refetched on
  every visit and invalidated by the star. Re-read `me/personal.ts`: writes go
  through `requirePageRole(…, 'viewer')`, both lists join `pages` with
  `deleted_at is null` and `visibleSpaceIds(user)`, the 50-row cap runs in the
  upsert's transaction, and nothing writes `pages` or `page_versions`.
- **`npm run check`:** exit 0, "all 7 steps ok", 348 server tests + 11 schema
  tests passed (personal.test.ts 13/13), 110 s wall, load 4.3 at the start.
- **`npm run test:e2e`:** exit 0, **40 passed** (both favourites tests among
  them), retries 0, no `.only`/`.skip` in `e2e/tests`, 3 workers, **95 s wall**
  (Playwright: 1.5 m), load 9.3 at the start and 10.2 at the end. That is under
  the 95 s busy-box limit but over the 75 s target. The speed gap belongs to
  done-check 10, not to this feature (favourites adds 2 tests, 11 s).
- **Hand check.** There is no person at a screen and no Docker on this
  machine, so I drove the built app in Chromium with a script I wrote for this
  (kept out of the repo). It ran against the same server build and an
  embedded Postgres migrated the same way as the compose stack. I looked at
  every screenshot myself. What ran:
  editor Eli starred "Watering plan" (Garden) and "Bread recipe" (Kitchen) from
  the header and opened "Seed list". Home showed Favourites: Bread recipe, then
  Watering plan, and Recently viewed: Seed list, Bread recipe, Watering plan.
  With the keyboard only, I tabbed to the first favourite and pressed Enter,
  then tabbed to the star and pressed Space to unstar. Home, reached through
  the in-app link with no reload, then listed only Watering plan. Then 3 edits
  with "Saved" each time, plus blur, visibilitychange and focus events: **0**
  extra `viewed` calls, and the order stayed Watering plan > Bread recipe > Seed
  list. Deleting the starred Watering plan took it off both lists. Viewer Vic
  starred Seed list and it worked. The Vault page link (Vic is not a member)
  showed "Nothing here" with no star; `PUT favourite` and `viewed` both gave
  404; nothing from Vault was in either list. With the server forced to refuse
  (500), the star went back to off, "Couldn't update favourites. Try again in a
  moment." showed and then faded, and the list stayed empty. The star's
  transition is 0.14 s normally and 0.000001 s with reduced motion. Light
  and dark screenshots of Home and the page: calm, spaced out, accent-only
  star, readable meta text, a visible focus ring on the star and the rows.
- **Pushed?** No. This workspace still has **no git remote and no GitHub
  credentials** (`git remote -v` is empty; no `gh`, no credential helper, no
  SSH key). The work is committed on `master` only.
- **ARCHITECTURE.md:** new §15 "Favourites and recently viewed". §12 item 8
  points at this file and at §15.

Gaps I am naming, not hiding (none of them blocks this feature):
1. The hand check was a scripted Chromium run, not a person in a browser
   against `docker compose up`. The compose run waits for a machine with
   Docker, the same as the open boxes in 02 to 05.
2. e2e wall time is 95 s against the 75 s target. That is done-check 10.
3. A small wording leftover: the 404 screen's button still says "Back to
   spaces", but that screen is now called "Home". It is cosmetic and goes to
   the designer as a one-line fix.

**Favourites and recently viewed is accepted. This closes the owner's option
(b): comments, templates, favourites.**
