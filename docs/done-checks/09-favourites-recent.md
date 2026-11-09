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
- [ ] Drizzle tables `pageFavourites` and `pageViews` in
      `apps/server/src/db/schema.ts` and migration
      `apps/server/drizzle/0006_favourites_views.sql` (with its meta snapshot),
      exactly as in the Tables section. `drizzle-kit generate` afterwards says
      there is nothing to migrate.
- [ ] `apps/server/src/me/personal.ts` (or one file of that kind) holds all the
      logic. Page checks go through `requirePageRole`; lists filter with
      `visibleSpaceIds` and `pages.deleted_at is null`. No second permission
      rule.
- [ ] Routes (signed out → 401 on all of them):
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
- [ ] Bodies on these routes are refused if they carry unknown fields (empty
      body expected).

### Checks that must exist and pass — `apps/server/test/personal.test.ts` (Vitest, real Postgres)
- [ ] An editor favourites two pages in two spaces: both are listed, newest
      first, with title and space; `GET /api/pages/:id` says `favourite: true`
      for them and `false` for a third page.
- [ ] `PUT` twice gives 204 twice and one row; `DELETE` removes it from the
      list; `DELETE` again gives 204.
- [ ] A viewer of a space can favourite and record views there (204), and the
      page's `version` and `updated_at` are unchanged afterwards.
- [ ] Another person's favourites and views never show in your lists, and an
      instance admin's lists hold only the admin's own.
- [ ] Opening pages A, B, A (three `viewed` calls) lists A then B, with one row
      each. 55 `viewed` calls on 55 pages leave 50 rows for that person and
      the list shows the newest 20.
- [ ] `GET /api/pages/:id` on its own does not add a view.
- [ ] Non-member of a restricted space: `PUT favourite` and `viewed` give 404.
      A member who favourited and viewed a page there, then is removed from the
      space, no longer sees it in either list; added back, it shows again.
- [ ] A soft-deleted page drops out of both lists, and its routes give 404.
      Deleting its space removes the rows (count the rows).
- [ ] Deleting a user removes their rows.
- [ ] A page titled `<img src=x onerror=alert(1)>` comes back as the same text.
- [ ] Signed out → 401 on every route.
- [ ] `npm run check` passes (this file is part of it).

---

## 9b — Screen

### Build
- [ ] **Star on the page.** In the page header, next to History and Comments,
      a star button for everyone who can read the page (viewers too). Its
      label is "Add to favourites" or "Remove from favourites" and it has
      `aria-pressed`. It changes at once and goes back with a quiet note if the
      server refuses.
- [ ] **View recorded on open.** Opening a page (from a link, the tree, search,
      Home or the address bar) calls `POST /api/pages/:id/viewed` once.
      Autosave, refetch and switching tabs do not.
- [ ] **Home gets two quiet sections** above the list of spaces:
      "Favourites" and "Recently viewed", each showing up to 8 pages as
      title + space name + a soft relative time, each a link to the page. When
      a list is empty it says so in one calm line (for example "Star a page to
      keep it here.") instead of hiding the heading. Starring or unstarring a
      page updates Home without a reload.
- [ ] Styles use only the design tokens (no raw colours, sizes or timings in
      the new CSS). Light and dark both look right. Motion is soft and short
      and turns off under `prefers-reduced-motion`. The star and the lists work
      with the keyboard alone and pass the contrast check (c6).
- [ ] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Checks that must exist and pass — `e2e/tests/favourites.spec.ts` (Playwright)
Set-up (people, spaces, pages) goes through the API helpers in `e2e/login.ts`.
**At most 2 tests**: c2 has timed out in the outside checker before, so the
suite must not grow much.
- [ ] An editor opens two pages, stars one, goes Home: the starred page is
      under "Favourites", both are under "Recently viewed" with the last one
      opened first. They unstar it from the page and Home shows the empty
      line. Checked once in dark mode.
- [ ] A viewer of a restricted space stars a page there and sees it on Home;
      an admin removes them from the space; after a reload the page is gone
      from both of their lists.
- [ ] `npm run test:e2e` passes in full: 38 + the new tests, no retries, no
      skips, no `.only`. The lead notes the wall-clock time and the load; it
      should stay under the 75 s target in `06-c2-time-budget.md`.

---

## Hand check (lead, in a browser, both themes)
- [ ] As an editor: star pages in two spaces from the page header, open
      several pages, go Home: both lists are right and in order. Unstar from
      the page: Home updates without a reload.
- [ ] Keep a page open and let autosave run for a while: Recently viewed does
      not jump around.
- [ ] As a viewer: the star is there and works. As a non-member: a page link
      in a restricted space is the 404 page, and nothing from it is in their
      lists.
- [ ] Delete a starred page: it is gone from both lists.
- [ ] Light and dark: the star and the two Home sections are calm, spaced out,
      no harsh colours; motion is quiet and instant with reduced motion on.
      Everything works with the keyboard alone.

## Lead check (closes the owner's option b)
- [ ] Read the diff myself: tables and routes match the Decisions and Tables
      sections, page checks go through `requirePageRole`, lists filter with
      `visibleSpaceIds`, and nothing here writes `pages` or `page_versions`.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself: all passed, exit 0, count and wall time
      noted here.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` and pushed if the workspace can reach GitHub (if
      there is still no remote, say so plainly in the record).
- [ ] ARCHITECTURE.md gets a short "Favourites and recently viewed" section:
      the two tables, filtering when read, the explicit `viewed` call, the
      50-row cap, and why co-editing needs no change. §12 gets a line pointing
      at this file.
