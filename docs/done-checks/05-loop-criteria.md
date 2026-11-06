# Done-check — Loop "Build the wiki in your order" (criteria c1–c6)

Owner of this check: Wiki Lead. Written 2026-11-06, loop round 1.

All four stages of the build order (core and auth, slash editor with embeds,
search and history, AI) are built and lead-checked: see `02-editor.md`,
`03-search-history.md`, `04-ai.md`. This file does not add features. It says,
for each of the loop's six criteria, the exact command that proves it, what
"pass" looks like, and what is still missing. The checker outside the team
decides; these are the commands we expect it to run.

Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`). No command
here may reach the network or cost money: AI tests run on the stub.

## c1 — The compose stack starts from a clean checkout and serves the app
- Command: `git clone <repo> x && cd x && cp .env.example .env && scripts/smoke.sh`
  (builds the image, `docker compose up -d`, waits for `/health`, checks the
  database round trip, tears down).
- Pass: `smoke.sh` exits 0, and `http://localhost:$PORT/` serves the login
  screen in a browser.
- [x] `docker compose config -q` exits 0 (the compose file is valid). Checked
      by the lead 2026-11-06.
- [ ] `scripts/smoke.sh` green on a machine with a running Docker daemon.
      **Blocked:** this machine's Docker client works but the team cannot reach
      the Docker service (`/var/run/docker.sock` is not usable from the
      workspace). Only the owner or the outside checker can run it. Asked in
      the team chat again this round.
- [x] Devops re-check after item 5a, 2026-11-06: 5a changed no schema and
      added no migration (confirmed: `git log` on `apps/server/drizzle` since
      5a shows nothing new), so `docker-compose.yml` and `docker/Dockerfile`
      need no change. `docker compose config -q` still exits 0. Since the real
      Docker daemon stays out of reach here, proved the same migrate-on-start
      path another way: full `npm run build`, then started the real built
      server against a real throwaway Postgres (`scripts/local-start.mjs`,
      the same non-Docker path `install.sh` uses) — migrations ran, `/health`
      returned `{"status":"ok"}`, and a real signup round-tripped through the
      migrated schema (201, user row back with a role). Stack torn down after.
      This is not a replacement for `scripts/smoke.sh` on the real image; it
      only shows the app+Postgres+migrations path itself is sound.

## c2 — The end-to-end suite passes, covering auth, permissions, the editor and embeds
- Command: `npm run test:e2e` (builds, starts the app on a throwaway
  Postgres, runs `e2e/tests/*.spec.ts` in Chromium).
- Pass: every test passes, none skipped.
- Coverage today (file → criterion):
  - auth: `wiki.spec.ts` (first sign-up becomes admin, log in, admin adds a
    viewer).
  - permissions, global role: `wiki.spec.ts`, `editor.spec.ts`,
    `embeds.spec.ts`, `video-links.spec.ts`, `history.spec.ts` (viewer can read,
    cannot edit, API answers 403).
  - permissions, per space: only indirectly, through search and AI
    (`search.spec.ts`, `ai.spec.ts`: an outsider finds nothing from a
    restricted space).
  - editor: `editor.spec.ts`. Embeds: `embeds.spec.ts`, `video-links.spec.ts`.
- [x] **Gap, next item (5a):** one browser test file
      `e2e/tests/permissions.spec.ts` that proves per-space permissions and
      nested pages directly, on screen. Boxes for it are below.

### 5a — Per-space permissions and nested pages in the browser
Small item: one new test file, no app changes unless a test finds a real bug
(then fix the bug, and say so in the report). Reuse the `logIn` / `newPage`
helpers pattern from `search.spec.ts`, and `resetDatabase` in `beforeAll`.
- [x] Admin (Ada) makes space A "Only members" and adds Eve as **editor** of A;
      makes space B open to everyone. Otto is a plain editor, not a member of A.
- [x] Ada makes a page in A and a **sub-page** under it; the sub-page shows
      nested under its parent in the page tree, and reopening it by URL works.
- [x] Otto: space A is not in his space list or sidebar; opening A's page by
      its URL shows the calm not-found screen (`screens/NotFound.tsx`), never
      the content; `GET /api/pages/<id>` answers 404 (by design a space you
      cannot read does not exist for you, `auth/permissions.ts:58`).
- [x] Eve: opens A's page and sub-page and can edit and save them (status
      "Saved").
- [x] Ada removes Eve from A in Space settings; after a reload Eve no longer
      sees A and its page URL is refused as for Otto.
- [x] Log out, then log back in, works (the session ends and comes back).
- [x] `npm run test:e2e` all green with the new file; `npm run check` green.
- Done by the coder, 2026-11-06: `e2e/tests/permissions.spec.ts`, 6 tests,
  one per box above. Writing it found a real bug: the login limit counted
  every login from one address, so a team behind one office address got
  locked out after about 30 good logins. Fixed: only failed logins count
  now (`apps/server/src/auth/rateLimit.ts`, `routes/auth.ts`), with two new
  tests in `apps/server/test/auth.test.ts`. Runs: the new file 6/6, full
  `test:e2e` 32/32, `npm run check` green (303/303 Vitest, originality ok,
  contrast ok).

## c3 — Unit and API tests pass, including search scoping and history restore
- Command: `npm run check` (typecheck, Vitest for `packages/editor-schema` and
  `apps/server`, originality scan, contrast check).
- Pass: exit 0, no test skipped.
- Search scoping: `apps/server/test/search.test.ts`. History restore:
  `apps/server/test/history.test.ts`. Per-space roles:
  `apps/server/test/permissions.test.ts`.
- [x] Baseline green this round: 301/301 Vitest (14 files), typecheck clean.

## c4 — The AI features pass against the stubbed provider and turn off cleanly without a key
- Commands: `npm run test:ai` (server, stub and injected fakes) and the AI part
  of `npm run test:e2e` (`e2e/tests/ai.spec.ts`, including "with AI off,
  Summarise and the Ask entry are both hidden").
- Pass: both green, with and without `ANTHROPIC_API_KEY` in the shell, and no
  network call.
- [x] Baseline green this round: `test:ai` 66/66, `ai.spec.ts` 4/4 inside e2e.
- Not needed for c4, still open in `04-ai.md`: one real-key hand check (needs a
  key from the owner).

## c5 — No branding of the tool we are modelled on is in the shipped files
(The loop states this criterion with the vendor's names; we do not write them
in the repo, because `check-original.mjs` rightly refuses them.)
- Command: `node scripts/check-original.mjs` (source tree) and, after
  `npm run build`, `node scripts/check-original.mjs apps/web/dist` and
  `node scripts/check-original.mjs apps/server/dist` (the built files that go
  into the image; the plain scan skips `dist`).
- Pass: all three print `check-original: ok`.
- [x] Both `dist` scans ok, checked by the lead 2026-11-06. The source scan
      runs inside `npm run check`.

## c6 — Both themes pass the contrast check
- Command: `node scripts/check-contrast.mjs` (inside `npm run check`).
- Pass: exit 0, light and dark both listed.
- [x] Baseline green this round: 50 pairs pass AA in both themes.
- [x] Re-checked 2026-11-06 (designer): still 50 pairs, ok, after reviewing
  the not-found screen below.

## Who does what next
- Coder (p12-coder): item 5a above.
- Tester (p12-tester): runs 5a's file three times in a row to rule out flakes,
  then the full `npm run test:e2e`.
- Self-host engineer (p12-devops): keeps `docker compose config -q` and
  `scripts/smoke.sh` correct; c1 needs Docker access from the owner.
- Designer (p12-design): done this round, see below.

### Designer's check, 2026-11-06: the not-found screen (5a)
`screens/NotFound.tsx` (`.empty`, `.empty-title`, `.btn-quiet`) already uses
only tokens from `tokens.css` — space, radius, color and the `--motion-fast`
transition on its button, nothing hand-picked. Screenshotted it in both
themes with a throwaway Playwright spec (`.leadcheck/design1/`, not
committed — that directory is gitignored, same pattern as the lead's hand
checks): signed up, went to a page URL that doesn't exist, flipped
`data-theme` on `<html>`, screenshotted.
- Light: calm cream background, dashed border, muted grey subtext, quiet
  white button. Reads fine.
- Dark: first capture (no wait after flipping the theme) showed the button
  and subtext almost invisible — ghostly grey on a background that hadn't
  caught up yet. Not a bug: `body` carries a 200ms
  (`--motion-base`) transition on `background-color`/`color` for the calm
  theme-switch fade, and the screenshot landed mid-transition. Waiting
  400ms before the second capture gave a clean, legible dark screen —
  dark background, light text, same quiet button, same layout as light.
  `check-contrast.mjs` only checks the token pairs at rest, so it would
  never have caught this either way; it's a screenshot-timing artifact,
  not something a real user sees (nobody screenshots their own screen 50ms
  into a theme toggle).
- No app change needed. `check-contrast.mjs` re-run after this review:
  still 50/50 pairs, ok.

## Baseline run, 2026-11-06 (lead)
- `npm run test:ai`: 66/66 passed, exit 0.
- `npm run test:e2e`: 26/26 passed (3.0 min), exit 0.
- `npm run check`: typecheck clean, 301/301 Vitest passed, contrast ok
  (50 pairs, both themes). The first run failed the originality scan on this
  very file (its c5 heading named the vendor); reworded, then
  `check-original.mjs` ok and `check-contrast.mjs` ok on a second run.
- `docker compose config -q`: exit 0. `scripts/smoke.sh`: not runnable here
  (no Docker service).
- So c2–c6 have green commands today; c2 still lacks the 5a coverage, and c1
  needs Docker.
