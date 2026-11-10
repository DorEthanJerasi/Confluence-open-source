# Done-check 10: the end-to-end suite (c2) must finish well inside the checker's time limit

Written by the lead, loop #3 round 4, 2026-11-10. This replaces the target in
`06-c2-time-budget.md` (which was written when the suite had 32 tests; it now
has 40).

## Why this is next
Every feature in the agreed order is built, and comments, templates and
favourites are done too. Five of six criteria are met. The one left is **c2**:
the outside checker ran `npm run test:e2e` and its time limit ran out
(exit 124) before the suite printed `passed`. The suite is correct; it is too
slow, and under heavy load it also starts to fail.

What we know about the limit: `npm run check` (c3) passes the checker at about
110 s. `npm run test:e2e` fails it at 105–150 s. So the limit sits somewhere
around 110–120 s, and the suite has to finish well under that **even when
this shared box is busy**.

No new features start until this is closed.

## Fresh measurement (lead, 2026-11-10 00:05, this commit)
`/usr/bin/time npm run test:e2e`, default 3 workers, load 8.8 at start, 9.5 at
end: **40 passed (1.8m), 112.0 s wall, exit 0**. Build and browser steps were
skipped (up to date), so almost all of that is Playwright.

| spec file   | tests | summed test time |
|-------------|-------|------------------|
| editor      | 5     | 46.5 s |
| ai          | 4     | 39.4 s |
| comments    | 3     | 31.1 s |
| permissions | 6     | 24.7 s |
| history     | 5     | 19.0 s |
| templates   | 3     | 16.1 s |
| video-links | 2     | 14.0 s |
| embeds      | 2     | 12.9 s |
| search      | 4     | 10.9 s |
| wiki        | 4     | 10.2 s |
| favourites  | 2     | 8.1 s  |
| **total**   | 40    | **232.9 s** |

What the numbers say:
- 233 s of test time over 3 workers is 78 s if perfectly spread. Playwright
  took 108 s, so **about 30 s goes to start-up and uneven spreading** (one
  worker gets editor + ai, about 86 s, while another sits idle at the end).
- **The first test in each file is the slow one**: editor 15.9 s, comments
  16.1 s, ai 20.3 s, while the tests after it take 1.5–8 s. Every test opens
  a fresh browser context, which downloads and parses about 1 MB of
  JavaScript (`index-*.js` 365 KB + `PageEditor-*.js` 663 KB, served
  uncompressed), and the first ones do it on three workers at once.
- The editor slash test alone is 19.6 s and has its own 90 s time limit.

Last round the tester also saw the default 3-worker run fail at load ~15
(5 timeouts, 9 not run) while a 1-worker run passed 40/40 in 3.6 min. A
failing test costs its full 30 s limit, which by itself pushes the run past
the checker's limit.

## Step 4 (item #121, tester, 2026-11-10 02:36): the three timed runs

Three `/usr/bin/time npm run test:e2e` runs in a row, right after each other,
on this shared box (load stayed at 17–22 throughout, well above the ≥12
the done-check asks for):

| run | result | wall clock | load start → end |
|-----|--------|-----------|-------------------|
| 1   | 40 passed, exit 0 | **94.75 s** | 17.22 → 18.86 |
| 2   | 40 passed, exit 0 | **81.22 s** | 18.86 → 19.46 |
| 3   | 40 passed, exit 0 | **119.46 s** | 19.46 → 22.32 |

All three runs were at load ≥ 15, so the 95 s target applies to each. Runs 1
and 2 meet it (94.75 s, 81.22 s). **Run 3 does not: 119.46 s, over the 95 s
limit.** All three printed `40 passed` and exited 0 — no failures, retries,
skipped tests or `.only` in any of them.

**Box 1 does not hold**: not all three runs in a row are under target: 1 of
3 (run 3) is over.
**Box 2 holds**: every run is 40 passed, exit 0, no retries/skips/`.only`/
failures.
**Box 3 holds**: the suite is the same 40 tests as step 3 (item #120), still
covering the full behaviour list from `06-c2-time-budget.md` plus comments,
templates, favourites and recently viewed — nothing was removed or changed
to make these runs.
**Box 7 holds**: ran straight after the three timed runs, same commit —
`npm run check`: all 7 steps ok, exit 0, 1:26.62 (includes the originality
scan and the contrast check, c5/c6); `npm run test:ai`: 66 passed (3 files),
exit 0, 17.0 s.

**What this says**: the suite is close but not reliably under the load-15+
target yet — one run in three still goes over by about 24 s. The gap looks
load-driven (this box was already busy with other work before and during
these runs; run 3 started at the highest load of the three, 19.46, and the
load kept climbing through it to 22.32), not a regression from step 3's
change. Reported in team chat; #121 does not tick box 1.

## The lean suite (lead, item #125, 2026-11-10): the browser does less

**Why.** Steps 1–5 made the suite smaller per file but not smaller overall.
The 41 tests add up to about **290–465 s of browser time** (the sum of the
per-test times Playwright prints; seven runs in `test-results/workers-cmp/`,
load 11–24). On a 4-core box at load 15–25 no worker count fits that inside
the checker's ~110–120 s, and steps 4–5 made it slower (142–162 s) and
flaky (2 of 3 runs failed). So the browser suite has to do less work.

**The rule.** Each feature keeps **one browser test of its real screen
path**: what a person clicks and sees. A check that is only about data or
rules (a role getting 403, a removed member losing access, a version list
being right) leaves the browser **only where a server test already proves
it and passes today**. The table names that test. If a row says "server"
and the named test does not really cover it, the check stays in the browser.
Merging tests is fine (one test may walk through several steps of the same
screen path). Set-up goes through the API helpers in `e2e/login.ts`, not by
clicking, except where clicking is the point.

### Where each behaviour is proven

"Browser" = kept on screen, in the lean file named in the last column.
"Server" = the browser check is removed; the named server test proves it
(under `apps/server/test/`, and `diffBlocks.test.ts` under
`packages/editor-schema/test/`; both run by `npm run test`, which is part of
`npm run check`).

| # | Behaviour | Browser test today | Proven by after the change | Lean file (budget) |
|---|-----------|--------------------|----------------------------|--------------------|
| 1 | First sign-up becomes admin, creates a space and a page | `wiki.spec.ts:35` | **Browser** (also `auth.test.ts:12`) | `wiki` (11 s) |
| 2 | Reopening the page shows the saved title | `wiki.spec.ts:52` | **Browser**, folded into row 1 (one reload) | `wiki` |
| 3 | Admin adds a person with the viewer role | `wiki.spec.ts:62` | **Browser**, folded into row 1 | `wiki` |
| 4 | Sub-page sits under its parent in the tree and reopens by URL | `permissions-subpage.spec.ts:12` | **Browser**, folded into row 1 (also `pages.test.ts:28`) | `wiki` |
| 5 | Log out ends the session, log in brings it back | `permissions-outsider.spec.ts:51` | **Browser**, folded into row 1 (also `auth.test.ts:43`) | `wiki` |
| 6 | Space admin makes a members-only space with an editor, and an open space | `permissions-settings.spec.ts:14` | **Browser** | `permissions` (7 s) |
| 7 | Someone outside the space does not see it in the list or by URL | `permissions-outsider.spec.ts:17` | **Browser**, list and URL only, folded into row 6. The API part: **server** `spaces.test.ts:42` | `permissions` |
| 8 | A member editor opens and edits the space's page and sub-page | `permissions-member.spec.ts:12` | **Server** `spaces.test.ts:31`, `spaces.test.ts:69`, `pages.test.ts:81`; editing itself is row 10 | – |
| 9 | Removed from the space, the person loses it after a reload | `permissions-removed.spec.ts:12` | **Server** `personal.test.ts:168`, `search.test.ts:74`, `comments.test.ts:250`, `templates.test.ts:301`, `ai-ask.test.ts:189` | – |
| 10 | Type, autosave, reload, text is still there | `editor.spec.ts:20` | **Browser** | `editor` (20 s) |
| 11 | Slash menu filters and inserts every block (headings, three list kinds, quote, callout, divider, code with highlighting, table with its toolbar), markdown shortcuts; block ids | `editor-slash.spec.ts:23` | **Browser** for the menu, the filter and every block on screen; **server** `pages.test.ts:216` and `pages.test.ts:227` for "every block type is stored, each with a unique id" | `editor` |
| 12 | Slash menu has no animation with reduced motion | `editor.spec.ts:45` | **Browser**, folded into row 10 (switch reduced motion on the same page) | `editor` |
| 13 | Two tabs: the second save gets the conflict note and keeps its text | `editor-conflict.spec.ts:16` | **Browser** (also `pages.test.ts:266`) | `editor-conflict` (9 s) |
| 14 | A viewer sees the page, its image, caption, file, video, players and link cards, with nothing editable and no upload control | `editor.spec.ts:35`, `wiki.spec.ts:75`, `embeds.spec.ts:148`, `video-links.spec.ts:181` | **Browser**, the four merged into one viewer test (also `attachments.test.ts:97`, `spaces.test.ts:31`) | `viewer` (5 s) |
| 15 | Image from the slash menu, by paste and by drop; caption; file block | `embeds.spec.ts:69` | **Browser** for upload, paste, drop, caption and file block; **server** `embeds.test.ts:26` for "only ids stored" | `embeds` (14 s) |
| 16 | Upload a video, paste YouTube, add Vimeo, other hosts refused, link cards | `video-links.spec.ts:64` | **Browser** for each step on screen; **server** `video.test.ts` (`videoEmbedUrl`) and `linkPreview.test.ts` for which hosts and cards | `video-links` (11 s) |
| 17 | A word is found with Ctrl+K, highlighted, and opens the page | `search.spec.ts:33` | **Browser** | `search` (8 s) |
| 18 | Page text that looks like HTML shows as text in results | `search.spec.ts:57` | **Browser**, folded into row 17 (also `search.test.ts:203`) | `search` |
| 19 | `/search?q=…` reload shows the same results, light and dark | `search.spec.ts:86` | **Browser**, folded into row 17 | `search` |
| 20 | A non-member of a restricted space gets no search results | `search.spec.ts:111` | **Server** `search.test.ts:74` | – |
| 21 | Two editors save; history lists both names | `history-list.spec.ts:28` | **Browser** | `history` (14 s) |
| 22 | An earlier version opens read-only with the changed block marked | `history-preview.spec.ts:11` | **Browser**, folded into row 21 (also `diffBlocks.test.ts`) | `history` |
| 23 | Restore puts the old text back and it survives a reload | `history-restore.spec.ts:12` | **Browser**, folded into row 21 (also `history.test.ts:302`) | `history` |
| 24 | Typing after a restore saves with no conflict note | `history-after-restore.spec.ts:12` | **Browser**, folded into row 21 (also `history.test.ts:341`) | `history` |
| 25 | A viewer sees versions but no Restore button, light and dark | `history-viewer.spec.ts:12` | **Server** `history.test.ts:384` (403 on restore). Dark mode stays covered in rows 19, 30, 34 | – |
| 26 | Summarise shows the first sentence in the card | `ai.spec.ts:21` | **Browser** | `ai` (18 s, rows 26–27) |
| 27 | Ask: the answer shows, and the [1] link and the Sources entry open the page | `ai-ask.spec.ts:37` | **Browser** | `ai` |
| 28 | A non-member asking gets "couldn't find", no sources | `ai-ask-access.spec.ts:43` | **Server** `ai-ask.test.ts:337`, `ai-ask.test.ts:411` | – |
| 29 | With AI off, Summarise and Ask are hidden and `/ask` shows the not-set-up note | `ai-ask-access.spec.ts:71` | **Browser** | `ai-off` (4 s) |
| 30 | An editor comments on a paragraph and on the page; marker and count survive a reload (dark mode too) | `comments.spec.ts:15` | **Browser** | `comments` (10 s) |
| 31 | A viewer can reply but not resolve or edit; the editor resolves and reopens | `comments-roles.spec.ts:23` | **Server** `comments.test.ts:107`, `comments.test.ts:154`, `comments.test.ts:210` (`:154` proves only the author may edit, refusing another editor and both kinds of admin; it has no viewer case of its own, so the tester confirms that is enough or the coder adds the viewer case) | – |
| 32 | The author edits and deletes their comment; a deleted root keeps its reply | `comments-author.spec.ts:12` | **Server** `comments.test.ts:154`, `comments.test.ts:171` | – |
| 33 | New page from a built-in template; Blank page is still empty; save a page as a template and reuse it | `templates-builtin.spec.ts:15`, `templates-saved.spec.ts:11` | **Browser**, the two merged | `templates` (11 s) |
| 34 | Edit and delete a saved template (dark mode) | `templates-edit.spec.ts:25` | **Server** `templates.test.ts:192` | – |
| 35 | A viewer sees no template control | `templates-viewer.spec.ts:11` | **Server** `templates.test.ts:287` | – |
| 36 | An editor stars a page, sees both Home lists in order, unstars it (dark mode) | `favourites.spec.ts:39` | **Browser** | `favourites` (8 s) |
| 37 | A viewer's favourite leaves both lists when they are removed from the space | `favourites.spec.ts:93` | **Server** `personal.test.ts:168` | – |

The behaviour list from `06-c2-time-budget.md` ("Point 3 coverage") is all in
this table: sign-up (1), log in/out (5), per-space roles (3, 6–9, 14),
nested pages (4), every slash block (11), embeds (14–16), two-tab conflict
(13), search scoping and both themes (19, 20), history view and restore
(21–25), AI summarise (26), ask with sources (27), restricted-space exclusion
(20, 28), AI off (29). Plus comments (30–32), templates (33–35), favourites
and recently viewed (36–37).

**The budget.** 14 lean files, about 18 tests. The per-file budgets above
add up to **150 s**. Today's tests for the same paths, measured one by one,
add up to about 220 s at load 15+, so meeting the budget needs the merges
(each merge saves a login and a cold page load, about 3–5 s) and API set-up,
not only fewer tests. A file over its budget is fine if the total holds.

### Lean-suite boxes (all must be true, on top of boxes 1–7 below)
8. [ ] Every row of the table is proven where it says. Every "server" row
   names a test that exists today and passes in `npm run test`. If a named
   test does not really cover its row, the check stays in the browser.
9. [ ] One browser test is kept per feature screen path (the "Browser" rows);
   none of them is dropped or emptied.
10. [ ] At most 18 test files under `e2e/tests/`.
11. [ ] Total browser time (the sum of the per-test times Playwright prints)
   is **150 s or less** in each of the three proof runs, at load 15 or more
   at the start of the run.

## The done-check (all must be true)
1. [ ] `npm run test:e2e` from the workspace root, default settings, finishes
   in **under 75 s wall clock** (`/usr/bin/time`) at load ≤ 10, and **under
   95 s** at load 15 or more. Three runs in a row, load noted at start and
   end of each, at least one of them at load ≥ 12.
2. [ ] Every run prints `N passed` and exits 0, where N is the number of
   tests in the lean suite (see "The lean suite" below; it replaces "N ≥ 40").
   No retries, no skipped tests, no `.only`, no failures, in all three runs.
   *(Unticked by the lead, item #125: step 6 had failures in 2 of 3 runs, so
   the tick from #121 no longer stands.)*
3. [ ] Coverage is not reduced: every row of the behaviour table below is
   proven where the table says, on screen or by the named server test.
   *(Unticked by the lead, item #125: the suite is being slimmed, so this
   has to be checked again against the table.)*
4. [ ] No raised time limits (per test or per check). No assertions removed,
   except a browser check the table moves to a named server test that
   already exists and passes.
5. [ ] The proof command stays `npm run test:e2e` with no environment
   variables the checker would not set.
6. [ ] The app's own behaviour does not change to suit the tests (for example
   the 1 s autosave delay stays). Changes to how the app is served are fine
   if they are right for real users too (see below).
7. [x] `npm run check` (c3), `npm run test:ai` (c4), originality (c5) and
   contrast (c6) still pass afterwards.

## Where to look first (the coder chooses, in this order of payoff)
1. **Measure the start-up.** Print how long global set-up takes (embedded
   Postgres start, database creation, three servers healthy) and how long the
   first `page.goto` takes in each worker. Record both here before changing
   anything, so we know which part to cut.
2. **Spread the work evenly.** Split `editor.spec.ts`, `ai.spec.ts` and
   `comments.spec.ts` so no one file is much more than ~20 s; each new file
   does its own set-up through the API helpers in `e2e/login.ts`. With more,
   smaller files, three workers finish close together.
3. **Cut the cold start.** Serve the hashed files under `/assets/` with a long
   `Cache-Control: immutable` header and compressed (gzip or brotli) — right
   for real users on any network, and less work per test. Log in once per
   person through the API and reuse it as Playwright's `storageState`
   instead of logging in through the page in every test, except in the tests
   whose point is the login form.
4. **Only if 1–3 are not enough:** look at a worker count that follows the
   machine (for example fewer workers when the load is far above the core
   count), but prove with numbers that it is faster overall, not just safer.

## Step 1: the three biggest files split (coder, item #118, 2026-11-10 01:28)
`editor.spec.ts`, `ai.spec.ts` and `comments.spec.ts` are now nine files.
Each one empties its database and builds its own starting point through the
API helpers in `e2e/login.ts` (new: `addComment`), so it can run on any
worker:

- editor: `editor.spec.ts` (type, save, reload; viewer; reduced motion),
  `editor-slash.spec.ts` (every slash block, table, ids),
  `editor-conflict.spec.ts` (two tabs, 409 note).
- ai: `ai.spec.ts` (Summarise), `ai-ask.spec.ts` (answer, [1] link, Sources),
  `ai-ask-access.spec.ts` (restricted space, AI off).
- comments: `comments.spec.ts` (adding through the panel),
  `comments-roles.spec.ts` (viewer replies, editor resolves and reopens),
  `comments-author.spec.ts` (edit, delete, deleted root keeps its reply).
  People, page and locators are shared in `e2e/comments-page.ts`.

No test, assertion or time limit was removed or raised. What a later test
used to inherit from an earlier one is now made through the API: the
"Hello calm world" page (editor-slash, editor-conflict), Beck's two comments
and Cleo's reply (comments-roles, comments-author, with the block id fixed in
the page doc), and the admin plus the open "Garden notes" page
(ai-ask-access). The things still done on screen are the things each test is
about. One check was added: comments-roles waits for the block marker before
resolving.

**One timed run**, `/usr/bin/time npm run test:e2e`, default 3 workers,
builds skipped (up to date): **40 passed (1.8m), 107.3 s wall, exit 0**.
Load 0.98 at start, **12.59 at end** (it climbed during the run).
Global set-up: **5.1 s** (initdb 1.0 s, Postgres start 0.2 s, create
databases 0.2 s, three servers healthy 3.6 s).

| spec file       | tests | summed test time | per test |
|-----------------|-------|------------------|----------|
| permissions     | 6 | 38.1 s | 2.7, 6.8, 4.0, 10.3, 7.3, 7.0 |
| templates       | 3 | 31.0 s | 7.1, 19.9, 4.0 |
| video-links     | 2 | 25.8 s | 18.6, 7.2 |
| history         | 5 | 24.0 s | 4.7, 2.9, 6.4, 4.9, 5.1 |
| wiki            | 4 | 20.8 s | 7.8, 5.2, 4.1, 3.7 |
| search          | 4 | 15.0 s | 5.2, 4.1, 3.5, 2.2 |
| embeds          | 2 | 13.2 s | 10.8, 2.4 |
| editor-slash    | 1 | 12.8 s | 12.8 |
| ai-ask-access   | 2 | 10.1 s | 8.0, 2.1 |
| ai-ask          | 1 | 9.6 s  | 9.6 |
| favourites      | 2 | 8.5 s  | 5.1, 3.4 |
| ai              | 1 | 8.2 s  | 8.2 |
| editor          | 3 | 7.8 s  | 3.9, 1.9, 2.0 |
| editor-conflict | 1 | 6.3 s  | 6.3 |
| comments-roles  | 1 | 5.8 s  | 5.8 |
| comments-author | 1 | 5.6 s  | 5.6 |
| comments        | 1 | 5.2 s  | 5.2 |
| **total**       | 40 | **247.8 s** | |

What this run says:
- The nine new files are each 5–13 s, so none of them holds a worker up any
  more. The split did what it was for.
- The run as a whole is not under the 75 s target yet (107 s, with the load
  rising to 12.6 while it ran). Set-up is only 5 s, so start-up is not the
  cost; the cost is the tests themselves under load.
- The big files are now the ones nobody split: **permissions 38 s,
  templates 31 s, video-links 26 s, history 24 s**. The slow single tests
  are templates' second test (19.9 s) and video-links' first (18.6 s).
- Next steps in "Where to look first" (2 for these four files, then 3:
  cached, compressed assets and a reused login) are still open. Boxes 1–2
  stay unticked until three runs meet the target.

## Step 2: compressed, long-cached assets (coder, item #119, 2026-11-10 01:53)
What changed (right for real users too, box 6):
- `apps/web/vite.config.ts`: after each build, a small plugin writes a
  `.br` (brotli, quality 11) and a `.gz` (gzip, level 9) copy next to every
  text file over 1 KB in `dist/assets`. The Dockerfile needs no change: it
  already runs this build and copies all of `dist`.
- `apps/server/src/app.ts`: `@fastify/static` now has `preCompressed: true`,
  so it sends the brotli copy if the browser accepts it, else gzip, else the
  plain file. Nothing is compressed per request. Hashed files in `/assets/`
  keep `Cache-Control: public, max-age=31536000, immutable` (the pattern now
  also matches the `.js.br` / `.js.gz` file actually sent) and get
  `Vary: Accept-Encoding`. `index.html`, client routes and other files stay
  `no-cache`.
- `apps/server/test/static.test.ts` (4 tests, pass): brotli sent with the
  immutable header and Vary, body decodes back to the original and is under a
  quarter of its size; gzip sent when brotli is not accepted; plain file when
  neither is; `/`, `/index.html`, a client route and `/favicon.svg` are
  `no-cache` and never `immutable` or a long max-age.

What the browser now downloads per fresh context:

| file              | plain   | brotli  | gzip    |
|-------------------|---------|---------|---------|
| PageEditor-*.js   | 663 KB  | 170 KB  | 209 KB  |
| index-*.js        | 365 KB  | 96 KB   | 111 KB  |
| PageScreen-*.js   | 35 KB   | 10 KB   | 11 KB   |
| index-*.css       | 47 KB   | 7 KB    | 8 KB    |
| **total**         | 1110 KB | 283 KB  | 339 KB  |

**One timed run**, `/usr/bin/time npm run test:e2e`, default 3 workers,
web and server freshly built just before (so builds skipped in the run):
**40 passed (1.5m), 93.5 s wall, exit 0**. Load **9.69 at start, 11.81 at
end**. Global set-up: **6.2 s** (initdb 1.4 s, Postgres start 0.3 s, create
databases 0.3 s, three servers healthy 4.2 s).

| spec file       | tests | summed test time |
|-----------------|-------|------------------|
| permissions     | 6 | 29.1 s |
| history         | 5 | 23.0 s |
| templates       | 3 | 16.6 s |
| embeds          | 2 | 15.2 s |
| video-links     | 2 | 14.4 s |
| editor-slash    | 1 | 14.3 s |
| search          | 4 | 13.6 s |
| ai-ask-access   | 2 | 11.9 s |
| ai-ask          | 1 | 10.9 s |
| editor          | 3 | 10.6 s |
| wiki            | 4 | 10.2 s |
| favourites      | 2 | 10.0 s |
| ai              | 1 | 8.6 s  |
| comments-roles  | 1 | 8.2 s  |
| comments-author | 1 | 7.4 s  |
| comments        | 1 | 6.8 s  |
| editor-conflict | 1 | 6.4 s  |
| **total**       | 40 | **217.2 s** |

What this run says:
- 107 s → 93.5 s wall, and summed test time 248 s → 217 s, with a higher
  load at the start (9.7 against 1.0). The two slowest single tests of step 1
  dropped: templates' second test 19.9 s → 11.3 s, video-links' first
  18.6 s → 1.5 s.
- Still over the 75 s target. Boxes 1–2 stay unticked until three runs meet
  it. Next in "Where to look first": a reused login and the permissions and
  history files (now the two biggest).
- One side cost: the web build took 253 s at this load. Brotli on the
  biggest file alone took 1.9 s when measured on its own; the rest is Vite.
  The build only runs when web sources change, so `npm run test:e2e` skips
  it on a normal run.

## Step 3 (item #120): one login per person per file, reused as storageState

What changed:
- `e2e/login.ts`: the first `logIn` (or `signUp`) of a person in a spec file
  saves the browser's storageState; every later `logIn` for that person puts
  the saved cookies into the test's browser context instead of posting the
  password again (each login is an argon2 check). New `contextFor(browser,
  user)` makes a second browser with Playwright's `storageState` option;
  `permissions.spec.ts` uses it for its two-browser tests.
- `e2e/reset-db.ts`: `resetDatabase()` also forgets the saved logins, since
  it empties the sessions table at the start of each file.
- Tests whose point is the login form are unchanged: `wiki.spec.ts` signs up
  and logs in through the forms, and the log-out test in
  `permissions.spec.ts` uses `logInWithForm`.
- `E2E_ARGS` launch hook removed from `playwright.config.ts`: nothing in the
  repo set it or documented it.

Timed run (2026-11-10), `npm run test:e2e`: **40 passed, exit 0, 139.8 s
wall** (Playwright 2.1 m), set-up 12.0 s (Postgres start alone 7.3 s).
**Load 24.5 at start, 29.2 at end** — two to three times the load of the
step 2 run (9.7 → 11.8), from work outside this project, so this time is not
comparable with step 2's 93.5 s and says nothing yet about the 75 s target.

An earlier run the same hour, while the load climbed from 9.9 to ~39, had
6 failures, all the first test of a file in the first ~3 minutes, all
timing out or failing on sign-up (one through the sign-up form, which this
change does not touch; one a 409 from a stalled earlier sign-up landing after
the reset). The other 33 passed, including every test that reuses a saved
login. Our processes used 1 m 33 s of CPU over that 7 min run.

Per-file summed test time, passing run:

| file | tests | summed |
|------|-------|--------|
| permissions     | 6 | 45.4 s |
| history         | 5 | 30.3 s |
| templates       | 3 | 25.9 s |
| video-links     | 2 | 22.0 s |
| embeds          | 2 | 20.9 s |
| editor-slash    | 1 | 19.6 s |
| search          | 4 | 19.0 s |
| ai-ask-access   | 2 | 16.6 s |
| editor          | 3 | 13.4 s |
| ai-ask          | 1 | 12.8 s |
| favourites      | 2 | 12.3 s |
| wiki            | 4 | 12.0 s |
| comments-author | 1 | 10.7 s |
| comments-roles  | 1 | 9.6 s |
| comments        | 1 | 9.1 s |
| editor-conflict | 1 | 8.8 s |
| ai              | 1 | 8.7 s |
| **total**       | 40 | **297.1 s** |

Still open: boxes 1–2 need three timed runs under 75 s; #121 does those
runs, ideally at a load near the earlier ones.

## Speed step 4 (item #122, coder, 2026-11-10): permissions, history and templates split

What changed: the three biggest files became 14, each setting itself up
through the API helpers, so they can land on different workers.

| was | now |
|-----|-----|
| `permissions.spec.ts` (6 tests) | `permissions-settings`, `-subpage`, `-outsider` (Otto + the log-out test), `-member`, `-removed` |
| `history.spec.ts` (5 tests) | `history-list`, `-preview`, `-restore`, `-after-restore`, `-viewer` |
| `templates.spec.ts` (3 tests) | `templates-builtin`, `-saved`, `-edit`, `-viewer` |

- Shared people, locators and set-up live in `e2e/permissions-page.ts`,
  `e2e/history-page.ts` and `e2e/templates-page.ts`, like
  `e2e/comments-page.ts`. Each set-up makes, through the same API calls the
  screens use, what the earlier tests used to leave behind: Eve added to
  space A, the parent page and sub-page, Beck's second version, a restore,
  the saved "Launch Plan" template and a page made from it.
- New helpers in `e2e/login.ts`: `addMember`, `savePage`,
  `restorePageVersion`. `addPerson` now returns the new user's id and
  `createPage` the page's version.
- Nothing removed or loosened. Every test and check is still there. No time
  limit changed. There is one test more (41, was 40): the long templates test
  ("save as template, reuse, edit, delete") is now two, "save and reuse" and
  "edit and delete". One check was added: `history-after-restore` first
  checks that the restored text is on the page. Tests still on screen: the
  space settings form, the Sub-page button, the history panel and Restore,
  the "Save as template" dialog, the template editor and the delete dialog.

Quick check of the 12 new files on their own at load ~15–20: 14/14 passed,
59.6 s. The slowest were `history-restore` (14.3 s, two tests at that point)
and `permissions-member` (14.2 s). `history-restore` was split again after
that.

**Timed run A** (before the templates test was split in two, 40 tests):
`/usr/bin/time npm run test:e2e`: **40 passed, exit 0, 124.5 s wall**,
**load 21.1 at start, 20.4 at end**. Summed test time 299.4 s. The step 3
run had 297.1 s at load 24–29.

**Timed run B** (final code, 41 tests): `/usr/bin/time npm run test:e2e`:
**41 passed (2.4 m), exit 0, 150.9 s wall**, **load 15.3 at start, 25.1
at end**. Set-up took 11.3 s, 9.7 s of it waiting for the three servers.
Summed test time 325.5 s.

| file | tests | summed |
|------|-------|--------|
| video-links           | 2 | 27.9 s |
| search                | 4 | 24.0 s |
| wiki                  | 4 | 22.3 s |
| templates-edit        | 1 | 20.9 s |
| editor-slash          | 1 | 18.8 s |
| embeds                | 2 | 16.3 s |
| permissions-member    | 1 | 14.9 s |
| ai-ask-access         | 2 | 13.9 s |
| editor                | 3 | 12.8 s |
| ai-ask                | 1 | 12.7 s |
| templates-builtin     | 1 | 12.4 s |
| editor-conflict       | 1 | 12.2 s |
| permissions-outsider  | 2 | 12.0 s |
| permissions-removed   | 1 | 11.2 s |
| ai                    | 1 | 11.1 s |
| templates-saved       | 1 | 10.7 s |
| permissions-subpage   | 1 | 9.2 s  |
| favourites            | 2 | 8.3 s  |
| comments-roles        | 1 | 7.8 s  |
| comments-author       | 1 | 7.2 s  |
| comments              | 1 | 7.0 s  |
| history-restore       | 1 | 5.9 s  |
| history-list          | 1 | 5.1 s  |
| history-viewer        | 1 | 4.8 s  |
| templates-viewer      | 1 | 4.7 s  |
| history-after-restore | 1 | 4.3 s  |
| history-preview       | 1 | 3.9 s  |
| permissions-settings  | 1 | 3.2 s  |
| **total**             | 41 | **325.5 s** |

What this says:
- The split did its own job. No file holds up a worker the way permissions
  (45 s) and history (30 s) did. 12 of the 14 new files are at or under
  ~12 s. The two left over are single tests that can't be split further
  without cutting them up: `templates-edit` (20.9 s, the template editor
  plus two pages made from the template) and `permissions-member` (14.9 s,
  typing into two pages).
- **It did not make the suite faster at this load.** Both runs were slower
  than the tester's #121 runs (81–119 s at load 17–22). Run B's load climbed
  to 25 during the run, and every file got slower with it. The biggest files
  now are ones outside this item: video-links, search and wiki.
- Each new file also pays for its own set-up: a database reset, a sign-up
  and one or two added people, each with a password hash. Under load that
  adds up. 14 files where there were 3 is about 11 extra set-ups.
- Two runs at shifting load can't separate the split's effect from the
  load's. Step 5 (#123, comparing 2, 3 and 4 workers at the same load) and
  the tester's three runs (#124) are where that gets settled.

## Speed step 5 (item #123, coder, 2026-11-10 03:24–03:45): 2, 3 or 4 workers

Six full `npm run test:e2e` runs one after another, the worker count set with
`E2E_WORKERS`, in the order **3, 2, 4, 4, 2, 3**. Going forwards and then
backwards puts each setting at the same average place in the sequence, so a
load that drifts up or down during the half hour affects all three settings
alike. Builds were skipped (up to date) in every run. Wall time is from the
start to the end of `npm run test:e2e`. Load is the 1-minute load at start and
end. 41 tests, same commit (5e8af031d) in all six.

| run | workers | result | wall | load start → end | set-up |
|-----|---------|--------|------|------------------|--------|
| 1 | 3 | 41 passed, exit 0 | 142.1 s | 10.8 → 14.4 | 8.8 s |
| 2 | 2 | 41 passed, exit 0 | 170.8 s | 14.4 → 14.5 | 5.3 s |
| 3 | 4 | 41 passed, exit 0 | 142.2 s | 14.5 → 18.2 | 9.5 s |
| 4 | 4 | 41 passed, exit 0 | 150.6 s | 18.2 → 21.3 | 13.7 s |
| 5 | 2 | 41 passed, exit 0 | 255.5 s | 21.3 → 19.1 | 5.4 s |
| 6 | 3 | **1 failed**, 40 passed, exit 1 | 157.6 s | 19.1 → 24.4 | 14.2 s |

| workers | mean wall | passing runs | mean load over its runs |
|---------|-----------|--------------|-------------------------|
| 2 | **213.2 s** | 2 of 2 | ~17.3 |
| 3 | **149.9 s** | 1 of 2 | ~17.2 |
| 4 | **146.4 s** | 2 of 2 | ~18.1 |

The run-6 failure: `search.spec.ts` "someone who is not a member of the
restricted space gets no results". Ctrl+K was pressed and the search box was
not focused within 10 s (`toBeFocused`, received "inactive"). It looks like
the key was pressed before the page had attached its shortcut under load, not
a wrong result. It did not happen in the 4-worker runs. It is reported in
team chat and was not changed here (this item only sets the worker count).

What this says:
- **2 workers is clearly the slowest**: 171 s against 142 s at load ~14, and
  256 s at load ~20, where 3 and 4 workers took 150–158 s. Using fewer
  workers when the box is busy makes it slower, not faster, so the default
  does **not** follow the load.
- **4 workers is as fast as 3 or a little faster, and steadier.** At the
  lower load (runs 1 and 3) both took 142 s, but the 4-worker run had more
  load (14.5 → 18.2 against 10.8 → 14.4). At the higher load, 4 took 150.6 s
  against 157.6 s for 3. The mean is 146.4 s against 149.9 s. That is a small
  lead, about 3.5 s, and with two runs each it is close to the noise. But
  both 4-worker runs passed in full, and one of the two 3-worker runs did not.
- The earlier worry that 4 browsers starve each other into timeouts
  (2026-11-07, load ~23) did not show up here, after steps 1–4 made each
  file smaller and each test cheaper.

**Change:** `e2e/workers.ts` default is now `Math.min(4, cpus().length)`,
one worker per core up to 4, instead of `Math.min(3, …)`. `E2E_WORKERS`
still overrides it. Nothing else changed: no test, check or time limit.

**Check run with the new default** (no `E2E_WORKERS`),
`/usr/bin/time npm run test:e2e`: "Running 41 tests using 4 workers",
**41 passed (2.6 m), exit 0, 157.8 s wall**, load **18.2 → 28.1** (the
highest load of all seven runs). Set-up 8.2 s.

Still open: none of these runs is under the 95 s load-15+ target. At this
load (14–28, against 17–22 in #121) all three settings are far over it, so
box 1 stays unticked. #124 (the tester's three runs) settles it.

## Step 6 (item #124, tester, 2026-11-10 04:00–04:09): three runs after steps 4 and 5

Three `/usr/bin/time npm run test:e2e` runs in a row, right after each other,
commit fa8c6492f, default settings (4 workers since step 5), on this shared
box, load 16.7–22.6 throughout (well above the ≥12 the done-check asks for):

| run | result | wall clock | load start → end |
|-----|--------|-----------|-------------------|
| 1   | 41 passed, exit 0 | **162.15 s** | 16.74 → 20.28 |
| 2   | 1 failed, 40 passed, exit 1 | **141.98 s** | 18.29 → 22.63 |
| 3   | 2 failed, 38 passed, exit 1, 1 did not run | **146.82 s** | 22.19 → 21.07 |

Failures:
- Run 2: `ai-ask-access.spec.ts` — "with AI off, Summarise and the Ask entry
  are both hidden, and /ask shows the not-set-up note" —
  `expect(locator).toBeVisible()` failed.
- Run 3: `ai-ask.spec.ts` — "asking about a word on a page shows the answer,
  and both the [1] link and the Sources entry open that page", and
  `favourites.spec.ts` — "an editor stars a page, sees both Home lists in
  order, then unstars it (dark mode too)" — `expect(locator).toHaveAttribute()`
  failed. A third test did not run because the worker crashed/closed after
  these failures.

**Box 1 does not hold**: none of the three runs is under the 95 s load-15+
target (162.15 s, 141.98 s, 146.82 s) — all three are well over, by 47–67 s.
**Box 2 does not hold either on this round**: run 1 alone is clean (41
passed, exit 0); runs 2 and 3 each have failures and run 3 has a test that
did not run. No retries, no skipped tests and no `.only` were configured in
any run — the failures and the one "did not run" are the suite breaking
under load, not a setting change.

**What this says**: steps 4 and 5 (smaller files, 4 workers) did not close
the gap. At load 17–23 the suite is both slower (142–162 s, against 81–119 s
for #121 at load 15–22) and now flaky (2 of 3 runs have real failures,
where #121's three runs were all clean). The two failed tests are in files
nobody split or touched in steps 4–5 (`ai-ask`, `ai-ask-access`,
`favourites`), and neither failure is a known-flaky assertion — one is a
visibility check, the other an attribute check, both on pages the test
itself just created, so this is not stale state from an earlier test.
Reported in team chat; #124 does not tick box 1 (box 2 already carried an
`[x]` from #121's three clean runs — see team chat for whether that should
be revisited given this round's failures).

## Who proves it
- Coder: slims the suite to the table, re-measures the workers setting,
  ticks 4, 5, 6, 9 and 10, records `npm run check` and one timed
  `npm run test:e2e` run here (load at start and end, total browser time),
  commits and pushes.
- Tester: runs it three times in a row on their own at load 12 or more,
  records wall time, total browser time and load here, and ticks 1, 2 and
  11 only if all three runs meet them. Checks every row of the table against
  the specs and the named server tests and ticks 3 and 8; re-checks 7.
- Lead: runs it once more and accepts or sends it back.
