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

## The done-check (all must be true)
1. [ ] `npm run test:e2e` from the workspace root, default settings, finishes
   in **under 75 s wall clock** (`/usr/bin/time`) at load ≤ 10, and **under
   95 s** at load 15 or more. Three runs in a row, load noted at start and
   end of each, at least one of them at load ≥ 12.
2. [x] Every run prints `N passed` with N ≥ 40 and exits 0. No retries, no
   skipped tests, no `.only`, no failures, in all three runs.
3. [x] Coverage is not reduced: every behaviour in the list in
   `06-c2-time-budget.md` (item #102, "Point 3 coverage") is still proven on
   screen, plus comments, templates, favourites and recently viewed.
4. [ ] No raised time limits (per test or per check) and no assertions removed
   to get under the target.
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

## Who proves it
- Coder: makes the change, ticks 1, 2, 4, 5, 6 with three timed runs recorded
  here (load at start and end), commits and pushes.
- Tester: runs it three times on their own, records the output here, ticks 3
  and 7.
- Lead: runs it once more and accepts or sends it back.
