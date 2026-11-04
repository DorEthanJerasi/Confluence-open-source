# Done-check — Stage 3: full-text search and page history

Owner of this check: Wiki Lead. Build order position: 3 of 4 (stage 2, the
editor and embeds, is in `docs/done-checks/02-editor.md`).

The stage is split into **three items**, so each one fits inside a single run
(big items have timed out before). Do them in order. Each starts only after the
lead has accepted the one before it.

- **3a** search: server and screen together (small).
- **3b** history: server side (table, snapshot rule, list, view, restore, tests).
- **3c** history: screen (history panel, preview, block diff, restore, e2e).

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.

Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it): `pages.doc_text` is written on every
save from `packages/editor-schema`. `pages.search` is the generated tsvector
(title weight A, body weight B) with the GIN index `pages_search_idx`
(migration 0001). `visibleSpaceIds(user)` is in `apps/server/src/auth/permissions.ts`.
`savePage` in `apps/server/src/pages/pages.ts` is the only path that writes a
page's title and body.

---

## 3a — Search limited to pages the user may see

### Build
- [x] `GET /api/search?q=…&limit=…` (any signed-in user; signed out gets 401).
      Returns `{ results: [{ pageId, title, spaceKey, spaceName, snippet, breadcrumbs }] }`,
      best match first. `limit` defaults to 20, and anything above 50 is
      treated as 50.
- [x] The query uses `pages.search @@ websearch_to_tsquery('english', q)` (so the
      GIN index is used), ranks with `ts_rank_cd`, and builds the snippet with
      `ts_headline` on `doc_text` (or on the title if the body has no match).
- [x] **The permission filter is inside the same SQL** and uses
      `visibleSpaceIds(user)`. There is no second permission rule and no
      filtering after the query in JavaScript. Soft-deleted pages, and pages
      under a deleted parent, never appear.
- [x] Title prefix for quick-find: a partial last word finds a page whose title
      word starts with it (typing `relea` finds "Release notes"). Only letters
      and digits from the user's text reach the prefix query.
- [x] Any input is safe: empty or only spaces gives `{ results: [] }`, and so do
      stop words like `the`. Quotes, `&`, `|`, `!`, `:*`, `(`, a 1,000-character
      string and non-Latin text all return 200, never 500. A query over 200
      characters is cut to 200.
- [x] **Snippets cannot carry HTML.** The server marks hits with markers that
      cannot be confused with page text, and the client turns them into `<mark>`
      and renders everything else as plain text. It is never inserted as raw
      HTML.
- [x] Screen: a search field in the top bar of `Shell`. `Ctrl+K` / `⌘K` focuses
      it (not `/`, which the editor uses). Enter opens `/search?q=…`, which lists
      the results with title, space name, breadcrumbs and the snippet with soft
      highlights. Clicking a result opens the page. With no results it says so
      calmly. The URL keeps the query, so reload and back work.
- [x] Styles use only the design tokens. The results list fades in quietly and
      respects `prefers-reduced-motion`. Light and dark both look right.

### Checks that must exist and pass
- [x] **API (Vitest, real Postgres), `apps/server/test/search.test.ts`:**
  - a word saved into a page body is found right after that one save, and a
    word only in the title is found too;
  - a title match ranks above a body-only match for the same word;
  - a non-member never gets a page from a restricted space, even when the title
    matches exactly. Then they are added as a member and get it, removed again
    and stop getting it;
  - an open space's pages are found by every signed-in user, including an
    instance viewer;
  - an instance admin finds pages in every space;
  - a deleted page and a child of a deleted page are not found;
  - `relea` finds "Release notes";
  - each odd input from the Build list returns 200;
  - `limit=500` returns at most 50;
  - a page whose text is `<img src=x onerror=alert(1)>` comes back with that
    text as data, and the snippet holds no tags apart from the hit markers;
  - signed out gets 401.
- [x] **E2E (Playwright), `e2e/tests/search.spec.ts`:**
  - type a made-up word into a page, wait for "Saved", press `Ctrl+K`, search
    it: the page is listed with the word highlighted, and clicking it opens
    the page;
  - a second user who is not a member of that restricted space searches the
    same word and sees "no results";
  - the `<img onerror>` page shows the text literally, and no `img` element
    appears in the results;
  - reload on `/search?q=…` shows the same results.
- [x] `npm run check` passes (typecheck, server tests, originality, contrast).

### Hand check by the lead (compose stack, browser)
- [ ] Two users and one restricted space: search from both accounts in light
      and dark mode. The member finds the page and the other user does not. The
      results page feels calm.

---

## 3b — Page history, server side

### Decisions (the lead's, fixed for this stage)
- New table `page_versions` (ARCHITECTURE.md §4): id, page_id, version, title,
  doc jsonb, author_id, created_at, **saved_at**, restored_from (nullable int).
  `created_at` is when the snapshot was opened; `saved_at` is the last save
  folded into it, and that is the time the screen shows.
- **Snapshot rule (§5):** the write happens inside `savePage`, in the **same
  transaction** as the page update, so the page and its history never
  disagree. After a save:
  - if the latest snapshot has the same author, is not a restore, and its
    `created_at` is less than 5 minutes ago, update that snapshot in place
    (version, title, doc, saved_at);
  - otherwise insert a new snapshot.

  Measuring from `created_at` means a long editing session still leaves one
  snapshot every 5 minutes or so.
- **Invariant:** after any save, the newest snapshot's `version`, `title` and
  `doc` are exactly the page's current ones.
- **Restore never deletes.** `POST /api/pages/:id/versions/:version/restore`
  with `{ baseVersion }` writes the old title and doc as a new current version
  through `savePage`. That adds a new snapshot with `restored_from = N`, which
  is never folded into later. Every earlier snapshot stays.

### Build
- [x] New migration file `0003_page_versions.sql` (applied migrations are not
      edited) creates `page_versions` with an index on `(page_id, version desc)`,
      `on delete cascade` from pages, and `on delete set null` for the author.
      It **backfills one snapshot for every existing page** (its current
      version, title, doc and `updated_by`), so older pages have history too.
- [x] `createPage` writes the first snapshot (version 1) in the same
      transaction.
- [x] `savePage` follows the snapshot rule above in one transaction, and a 409
      writes no snapshot. Moving a page writes no snapshot.
- [x] `GET /api/pages/:id/versions?before=<version>` (space viewer and above):
      newest first, 50 at a time. Each entry has `version`, `title`, author
      `{ id, name }` (or null if the user was removed), `savedAt` and
      `restoredFrom`. No doc bodies in the list.
- [x] `GET /api/pages/:id/versions/:version` (space viewer and above): that
      snapshot's title and doc. A version number that belongs to no snapshot,
      or to another page, gives 404.
- [x] Restore route as above (space editor and above). A stale `baseVersion`
      gives 409 and changes nothing. A viewer gets 403. A non-member of a
      restricted space, a deleted page or an unknown version gives 404 (the
      same as every other page route). The restored doc passes the same
      validation as a normal save. Attachments it refers to still load, because
      their rows are not removed when a block is taken out of the doc.
- [x] Every history route checks permission through `requirePageRole`, so it
      uses the one permission path.

### Checks that must exist and pass
- [x] **API (Vitest, real Postgres), `apps/server/test/history.test.ts`:**
  - creating a page makes snapshot version 1;
  - two quick saves by the same author give one snapshot, holding the second
    save's content and version;
  - a save by a second author gives a new snapshot;
  - a save more than 5 minutes after the snapshot opened gives a new snapshot
    (the test controls the clock or moves `created_at` back; it does not
    sleep);
  - the invariant holds after every save in the test;
  - a 409 save writes no snapshot, and a move writes none;
  - restoring version 1 of a page saved 3 times: the page is back to version
    1's title and doc, its version number goes up, and the new snapshot has
    `restored_from = 1`. All older snapshots are still listed, and restoring
    the pre-restore version afterwards works too ("any earlier version");
  - an edit by the same author right after a restore makes a new snapshot (the
    restore snapshot is not changed);
  - a viewer can list and read versions but gets 403 on restore; a non-member
    of a restricted space gets 404 on all three routes; a stale `baseVersion`
    on restore gets 409;
  - an image block's attachment still downloads after a restore that brings it
    back;
  - list paging: 60 snapshots give 50, then 10 with `before`;
  - the migration backfill: a page created without a snapshot row gets one
    (or the test runs the backfill SQL on a seeded page).
- [x] `npm run check` passes.

**Lead check of stage 3b (item #74, 2026-11-04): pass.** `npm run check` run
by the lead: 235 passed, 1 skipped (AI placeholder), `history.test.ts` 19 of
19 on real Postgres, originality and contrast ok. Code read against every box:
`0003_page_versions.sql` (unique index on `(page_id, version desc)`, cascade /
set null, idempotent backfill); `createPage` and `savePage` write the snapshot
in the page's transaction, a 409 or a move writes none, restores are never
folded into; `pages/history.ts` and the three routes in `routes/pages.ts` all
go through `requirePageRole` (viewer for list and read, editor for restore),
and restore goes through `savePage` with `savePageBody` validation. Tests
check the invariant after every save (`expectInvariant`). Nothing missing.

---

## 3c — Page history, screen

### Build
- [x] A quiet "History" control on `PageScreen`, for everyone who can read the
      page, opens a side panel. It lists versions newest first with the
      author's name, a relative time (the exact time on hover) and a soft
      "Restored from version N" label where it applies. "Load older" fetches
      the next 50.
- [x] Choosing a version shows it read-only, using the same schema and renderer
      as the viewer mode, with a block-level diff against the current page:
      blocks are matched by their `id`, and added, removed and changed blocks
      get soft token-based tints plus a text label, not colour alone.
- [x] The block diff is one pure function, `diffBlocks(oldDoc, newDoc)`, in
      `packages/editor-schema` (or `packages/shared`), with no DOM use, so the
      co-editing server can reuse it later.
- [x] Space editors and admins see **Restore this version**. It asks once ("This
      becomes the current page. Nothing is deleted."), then restores. The open
      editor loads the restored doc and its new version, so the next edit saves
      with no 409. Viewers never see the Restore button.
- [x] If the page changed elsewhere (409), say so plainly and offer Reload,
      just like the editor does.
- [x] Panel open/close and list fades are quiet, respect
      `prefers-reduced-motion`, and use only tokens. Light and dark both look
      right.

### Checks that must exist and pass
- [x] **Unit:** `diffBlocks` on two docs gives the right added, removed and
      changed ids, and unchanged blocks are left out. A reordered block is not
      reported as changed. This runs inside `npm run check`.
- [x] **E2E (Playwright), `e2e/tests/history.spec.ts`:**
  - user A writes "first text" and user B (a space editor) replaces it with
    "second text". History lists both versions with the right names;
  - opening A's version shows "first text" read-only with the changed block
    marked;
  - Restore puts "first text" back in the editor. After reload it is still
    there, and history lists the restore entry ("Restored from version …")
    above both earlier versions;
  - typing after the restore saves cleanly ("Saved", no conflict note);
  - a viewer opens History, sees the versions, and has no Restore button;
  - the dark-mode history panel renders (screenshot read by the lead).
- [x] `npm run check` passes and `npm run test:e2e` passes in full (older specs
      included).

**Lead check of stage 3c (item #79, 2026-11-04): not yet a pass, one box open.**
`npm run check` run by the lead: exit 0 (11 diff tests, 235 server tests, 1
skipped AI placeholder, originality and contrast ok). `history.spec.ts` 5 of 5
pass, in the full run and again alone. Dark and light screenshots
(`e2e/test-results/history-{dark,light}.png`) read by the lead: panel, version
rows, "Current" and "Restored from version N" tags, the read-only version bar
and the labelled "Changed since this version" tint all render calmly in both
themes. Code read: `history/HistoryPanel.tsx` (newest first, author, relative
time with exact time on hover, Load older through `nextBefore`, Restore only
when `canEdit`, one confirm with the agreed words, 409 shows the conflict note
with Reload), `history/VersionDoc.tsx` (same `getExtensions` + `embedViews` as
the editor, read-only, diff from `diffBlocks`, every tint carries a text
label), `screens/PageScreen.tsx` (restore reloads the page and starts a new
saver, so the next save has no 409), and the panel CSS (tokens only, open and
close motion, reduced motion handled in `tokens.css`). Load older and the 409
path on this screen are covered by the server tests (60 snapshots page 50 + 10;
stale `baseVersion` gives 409) and the code read, not by a browser test.
Was open: `npm run test:e2e` did not pass in full. Fixed by the tester
(item #78): see note below.

### Hand check by the lead (compose stack, browser)
- [ ] Edit a page as two users over a few minutes, open History, restore the
      oldest version, then restore the newest pre-restore one. Both work and
      nothing is lost. It feels calm in light and dark.

---

## Note on the compose boxes
This machine has no running Docker daemon (see the open boxes in
`02-editor.md`). Until the owner provides one, the lead runs the hand checks on
the same built app the e2e suite uses (embedded Postgres), records that in the
lead review, and leaves the compose part of each hand-check box open.

## Which project criteria this stage moves
- "Full-text search covers all pages the user is allowed to see": 3a.
- "Page history can restore any earlier version": 3b and 3c.
- e2e coverage of search and history restore (ARCHITECTURE.md §11): 3a and 3c.
- Originality (`check-original`) and contrast in both themes must stay green
  after the new screens.
