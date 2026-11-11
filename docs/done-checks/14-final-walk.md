# Done-check 14: final walk of the owner's brief

Owner of this check: Wiki Lead. Walked 2026-11-11 (item #153).

This check adds no features. It goes through every point of the owner's done
list in a real browser, on a fresh `install.sh` start, and records what was
seen. Labels (the last approved feature, #152) were signed off before this
walk.

## How it was run

1. Fresh start: `PORT=4317 LOCAL_DATA_DIR=<empty folder> AI_PROVIDER=stub
   bash install.sh`. It ran `npm ci`, `npm run build`, started its own new
   Postgres, ran the migrations and logged "AI features: on" (the stub).
   `/health` returned `{"status":"ok"}`.
2. Walk: `node e2e/walk-brief.mjs http://127.0.0.1:4317 docs/final-walk`.
   It drives Chromium as four people at once: Ada (first sign-up, admin), Eve
   (editor, added by Ada), Vera (viewer, added by Ada) and Sam (signs himself
   up and is not a member of the members-only space). Every step is a check
   that passes or fails, and the walk keeps going after a failure.
3. I looked at every screenshot in `docs/final-walk/shots/` myself, and
   looked again at the every-block, search, history, Ask, trash, refused
   and dark Home shots before signing this off.

**Result: 25 of 25 steps passed** on that fresh start
(`docs/final-walk/results.json`, run at 2026-11-11 11:06 UTC).

Before that final run, four practice runs on throwaway databases found only
mistakes in my own walk script, none in the app. The script typed too
early, its checks were too strict, and its waits were too short on this busy
machine. Those were fixed in the script and the final run was made from
scratch.

## The brief, point by point

- [x] **Own name, look and code.** It is called Stillwater and has its own
      wave logo and calm palette. No names or assets of the product it is modelled on were seen
      anywhere on the screens walked. `npm run check` includes the
      originality scan.
- [x] **Self-hostable, used from a browser.** `install.sh` started the app
      and its database from nothing. Everything below was done in a browser
      against that start. `docker compose up` itself could not be run here:
      the workspace has no Docker access (see `05-loop-criteria.md`, c1).
      The compose file is still valid, and the image uses the same start and
      migration path.
- [x] **Sign-up and log-in for several people.** The first sign-up through
      the form became admin (1a). The admin added an editor and a viewer
      in "Add a person" (1b). A fourth person signed up through the form,
      logged out and logged back in (1c). All four are listed with their
      roles (1d, `01-admin-people.png`).
- [x] **Admin, editor and viewer roles, and per-space permissions.** Ada
      made an open space (Harbour) and a members-only space (Lighthouse)
      (2a). In the space settings she added Eve as an editor and Vera as a
      viewer (2b, `02-space-settings.png`). Sam is an editor but not a
      member. He did not see Lighthouse on Home, and its space, page and
      sub-page links refused him (2d, `02-outsider-refused.png`). Vera could
      read but not edit or add pages (2e, `02-viewer-readonly.png`).
- [x] **Spaces and nested pages.** Three levels deep: Lamp manual > Night
      checks > Winter routine, shown in the tree and the breadcrumb (2c,
      `02-nested-pages.png`).
- [x] **Block editor with slash commands.** Eve used the slash menu for a
      heading, bullet list, task list, quote, code block (highlighted),
      divider and table (3a, 3d).
- [x] **Every kind of embed.** Image upload with a caption, and a file
      upload whose Download link returned the exact bytes (3b). An uploaded
      video plays in the page. A pasted YouTube link and a pasted Vimeo link
      became players (3c). A link preview card, and a plain link card when
      the fetch is refused (3d). After a reload all of them were still
      there (`03-every-block-light.png`, `03-every-block-dark.png`).
- [x] **Full-text search, only over pages the user may see.** Eve found
      both Lighthouse pages, with the word highlighted
      (`04-search-member.png`). Vera found the sub-page by a word in its
      body. Sam's search showed neither page (4a, `04-search-outsider.png`).
- [x] **Page history restores an earlier version.** Eve changed Ada's page.
      History listed both people's versions. The earlier one opened
      read-only with the changed block marked (`05-history-preview.png`).
      Restoring it brought the old text back, and it stayed back after a
      reload (5, `05-history-restored.png`).
- [x] **AI summary and answers with sources (stub).** Summarise showed the
      page's summary (6a, `06-summary.png`). Ask gave an answer with a [1]
      citation and a Sources entry, and the source link opened the page (6b,
      `06-ask-sources.png`). Sam asked the same question and was never shown
      the members-only page (6c).
- [x] **Calm, soft look with quiet motion, light and dark.** Home, the page
      with every block, and the settings screen were looked at in both
      themes, with reduced motion on as well (9, `09-*.png`). Spacing is
      wide, colours are soft and both themes read clearly.
- [x] **Built so real-time co-editing can be added later.** No change since
      `ARCHITECTURE.md` (Tiptap JSON with stable block ids, ready for Yjs).
      The walk depends on this: history marked the changed block by its id,
      and restore kept the same page address.
- [x] **The approved extras still work in the same walk.** Trash: Eve
      deleted a sub-page, it left the tree and search, Vera was told she
      cannot see the trash, and Eve restored it to the same address
      (7, `07-trash.png`, `07-trash-viewer.png`). Also tested: a comment read
      by the viewer (8a), a label found with `label:` in search (8b), a
      favourite on Home (8c) and My tasks (8d).
- [x] **All automated checks pass.** I ran them again after this walk, once
      `install.sh` had reinstalled the packages. The results are under
      "Lead runs" below.

## What this walk could not show, and why

- **`docker compose up`**: there is no Docker access in this workspace (as
  before).
- **A real Anthropic key**: AI ran on the stub, as agreed. With a real key
  it goes through the same provider interface.
- **A live link-preview fetch and live YouTube/Vimeo players**: this machine
  has no internet. The rich card was drawn from a canned preview reply, the
  same way `e2e/tests/video-links.spec.ts` does it. The refused-fetch plain
  card is real. The YouTube and Vimeo players were placed with the right
  addresses, but their content was blocked, so they show as empty frames in
  the screenshots.
- **The uploaded image at a visible size**: the walk uploads a 1×1 pixel
  test image. The walk proved it loaded (its real width came back as 1) and
  the caption sits under it, but in `03-every-block-*.png` the picture
  itself is too small to see. Larger images are covered by
  `e2e/tests/embeds.spec.ts`.
- In `06-ask-sources.png` the answer looks pale because the screenshot
  caught it while it was still fading in. The text is full strength once
  the fade ends.

## Small things noticed (not part of the brief, not fixed here)

- When the walk moved the cursor with Ctrl+End and pressed Enter after an
  image, video or link card at the very end of a page, the next block went
  in above that embed, not below it. A person clicking where they want to
  write is not affected. Typing below a last-place embed with only the
  keyboard deserves a look in a later round. **Fixed in item #154:**
  Ctrl+End (Cmd+Down on a Mac) now puts the caret in the gap below a
  last-place card (`apps/web/src/editor/keys.ts`), so Enter or typing
  starts a new line under it. Proven by the e2e test "Ctrl+End then Enter
  after a last-place card writes below it" in `e2e/tests/embeds.spec.ts`
  (image, video and link card), which failed before the fix.
- In full-page screenshots the left sidebar's background ends at the window
  height. On a real screen the sidebar stays put while the page scrolls, so
  nobody sees this.

## Lead runs after the walk (Node 22)

- `npm run check`, first run (load 13.5 → 9.1): **failed, exit 1.** Two
  causes. (1) The originality scan caught the original product's name in
  this file's own text. I reworded it, and the scan passes. (2) Server tests
  hit a 60 s set-up timeout in `trash.test.ts`, then a database deadlock in
  `templates.test.ts` and a different query plan in `search.test.ts`. These
  passed on every earlier run and on the rerun with no code change, so they
  came from the busy machine. They are still a sign that the server tests can
  break when the machine is overloaded.
- `npm run check`, rerun (load 19.3 → 15.7): **all 7 steps ok, exit 0**,
  396 server tests and 31 web tests passed, 112.26 s wall.
- `npm run test:e2e` (load 9.1 → 20.1): **24 passed, exit 0**, no retries,
  204.92 s wall. That is slower than the 95 s limit and the ~110 s checker
  limit. The run began with a Chromium install step, because `install.sh`
  had just reinstalled the packages, and load climbed to 20 during it.
  Earlier runs on a quieter machine took 65 to 90 s (items #151, #152).
- `npm run test:e2e`, second run once Chromium was in place (load 12.7 →
  17.6): **24 passed, exit 0**, no retries, **84.23 s wall**, which is
  within both limits.
