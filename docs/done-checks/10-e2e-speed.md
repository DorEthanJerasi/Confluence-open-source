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

## The done-check (all must be true)
1. [ ] `npm run test:e2e` from the workspace root, default settings, finishes
   in **under 75 s wall clock** (`/usr/bin/time`) at load ≤ 10, and **under
   95 s** at load 15 or more. Three runs in a row, load noted at start and
   end of each, at least one of them at load ≥ 12.
2. [ ] Every run prints `N passed` with N ≥ 40 and exits 0. No retries, no
   skipped tests, no `.only`, no failures, in all three runs.
3. [ ] Coverage is not reduced: every behaviour in the list in
   `06-c2-time-budget.md` (item #102, "Point 3 coverage") is still proven on
   screen, plus comments, templates, favourites and recently viewed.
4. [ ] No raised time limits (per test or per check) and no assertions removed
   to get under the target.
5. [ ] The proof command stays `npm run test:e2e` with no environment
   variables the checker would not set.
6. [ ] The app's own behaviour does not change to suit the tests (for example
   the 1 s autosave delay stays). Changes to how the app is served are fine
   if they are right for real users too (see below).
7. [ ] `npm run check` (c3), `npm run test:ai` (c4), originality (c5) and
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

## Who proves it
- Coder: makes the change, ticks 1, 2, 4, 5, 6 with three timed runs recorded
  here (load at start and end), commits and pushes.
- Tester: runs it three times on their own, records the output here, ticks 3
  and 7.
- Lead: runs it once more and accepts or sends it back.
