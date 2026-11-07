# Done-check 06: c2 (end-to-end suite) must finish well inside the checker's time limit

Written by the lead, loop #3 round 4, 2026-11-07.

## Why this is next
All features in the agreed order (core and auth, slash editor with embeds,
search and history, AI) are built and pass. What the outside checker still
marks as not met:

- **c2** — exit 124, i.e. the checker's time limit ran out before the suite
  printed `passed`. The suite itself is green: I ran `npm run test:e2e` myself
  just now and got **32 passed (2.1m), 2m13s wall clock, at load 5.9 on this
  4-core box**. The tester saw 1.6m at a quieter moment. So the suite is
  correct but too slow; on a busier box it runs past the checker's limit.
  c3 (`npm run check`) went from timing out to passing once it was cut to
  under a minute, so the same fix applies here.
- **c1** — the sandbox blocks the Docker socket (devops proved it in round 3).
  No code change fixes that; it is a question for the orchestrator/owner,
  asked in team chat. Not part of this check.

## The done-check (all must be true)
1. `npm run test:e2e` from the workspace root finishes in **under 75 seconds
   wall clock** (measured with `/usr/bin/time`), on this box, in **3 runs in a
   row**, with the load average noted for each run. At least one of the three
   runs is at load ≥ 5.
2. Every run ends with `N passed` and exit 0, where N ≥ 32, **no retries, no
   skipped tests, no `.only`**.
3. Coverage is not reduced: every behaviour the 32 tests prove today is still
   proven on screen — sign-up/first admin, log in/out, per-space roles
   (admin/editor/viewer, member/non-member, removal), nested pages, every
   slash-command block, image/file/video/link embeds, two-tab conflict, search
   scoping in both themes, history view and restore, AI summarise, ask with
   sources, restricted-space exclusion, AI off hides the UI.
4. No raised timeouts and no fewer assertions to get under the limit.
5. The proof command stays `npm run test:e2e` — no environment variables or
   filters the checker would not set.
6. `npm run check` (c3), `npm run test:ai` (c4), the originality (c5) and
   contrast (c6) checks still pass afterwards.

## Where the time goes today (from my run)
| spec file    | tests | summed test time |
|--------------|-------|------------------|
| permissions  | 6     | 72.5s |
| editor       | 5     | 58.2s |
| history      | 5     | 52.9s |
| video-links  | 2     | 36.8s |
| search       | 4     | 34.6s |
| ai           | 4     | 34.1s |
| wiki         | 4     | 19.6s |
| embeds       | 2     | 16.2s |

~325s of test time over 3 workers, plus ~15s of start-up. The process tree
used about 118s of CPU over 133s of wall time, so much of it is waiting on
the UI, not raw CPU.

## Suggested ways in (the coder chooses)
- Do set-up steps (sign-up, log-in, creating spaces, people and pages)
  through the API or a saved login state, and keep the clicking only in the
  tests whose point is that click path (the login form, the "New space"
  dialog, and so on — each proven once).
- Split the three biggest files so the workers stay evenly loaded.
- Look for waits on fixed timers (`waitForTimeout` in embeds and video-links,
  the autosave delay) and wait on the actual event instead.

## Who proves it
Coder makes the change and records the 3 timed runs here. Tester then runs
it 3 times on their own and records the output here. Only then does it count.
