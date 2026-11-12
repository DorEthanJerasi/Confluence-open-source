# Done-check 16: export to Markdown and PDF

Owner of this check: Wiki Lead. Written 2026-11-12 (item #166).
This is feature 2 of 3 in the order the owner approved on 2026-11-11 (option
a): mentions, notifications and following (done-check 15), then **export to
Markdown/PDF**, then single-page locks. Export is done only when every box
below is ticked, the work is committed, and `npm run check` and
`npm run test:e2e` pass with exit 0.

**When the build may start.** Under the rule written in item #165 (top of
done-check 15), building export starts once the lead has signed mentions off.
It does not wait for the push box. On the day this was written, mentions is
**not signed off yet**: the lead's own clean timed e2e run is still missing,
because the machine was too loaded for the test servers to start. This file
can be written now; item 16a cannot start before that sign-off.
**Update, item #169 (2026-11-12): mentions is signed off** (end of
done-check 15, under its new Time rule). Item 16a may start.

**Push.** The workspace has no GitHub address (`git remote -v` is empty). As
for every feature since #165, the push box below stays open and says it is
waiting on the owner's GitHub address. Everything is committed on `master`
locally and pushed at once when the owner gives the address.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **16a** server: the two export formats, the page walk, the permission and
  trash rules, the route, the server tests.
- **16b** screen: the Export menu on the page, the one e2e test.

16b starts only after the lead has accepted 16a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it):
- `visibleSpaceIds(user)`, `effectiveRole`, `requireSpaceRole`,
  `requireSpaceByKey` and `requirePageRole` in
  `apps/server/src/auth/permissions.ts` and `pages/pages.ts` are the one
  permission path. A trashed page, a page under a trashed page, and every page
  in a trashed space are already 404 through them (done-check 11).
- **Trash marks a whole branch.** `deletePage` sets `deleted_at` on the page
  and every live page under it in one statement, so "live sub-pages" means
  walking down `parent_id` and stopping at any page whose `deleted_at` is set.
  `byPosition` in `pages/pages.ts` is the tree order the sidebar uses.
- **Files.** `readableAttachment(db, user, id)` in
  `apps/server/src/files/attachments.ts` returns an attachment only if the
  user can read its space and its page is live (404 otherwise). The
  `FileStorage` in `files/storage.ts` reads the bytes. `contentDisposition`
  builds a safe download header. `cleanFilename` makes a safe file name.
- **The document.** `parseDoc` and `getDocSchema` in
  `packages/editor-schema/src/index.ts` are the one schema. Its nodes are the
  `TOP_LEVEL_TYPES` list plus lists, task items (with `assignee` and `due`),
  table rows and cells, mentions and the usual marks (bold, italic, strike,
  code, link). `nodeToText` gives plain text.
- `config.publicUrl` in `apps/server/src/env.ts` is the address the wiki is
  reached at.
- E2E set-up helpers in `e2e/login.ts`: `addPerson`, `createSpace`,
  `createPage`, `logIn`, `signUp`.

---

## Decisions (the lead's, fixed for this feature)

- **Export is read-only and made on the server, from the saved document.**
  The server reads `pages.doc` through `parseDoc` and turns the one schema
  into Markdown or PDF. It never writes `pages`, `page_versions` or any other
  table, and it never calls `savePage`. No browser, no headless Chrome and no
  print dialog are involved, so the self-host image stays small and the same
  file comes out on every machine.
- **Two new dependencies in `apps/server` only**, both plain JavaScript with
  no native parts (they build on the Alpine image as it is):
  - `pdfmake` for PDF, with its bundled Roboto fonts (Apache 2.0 licence,
    shipped in the package, never fetched while running). Characters the font
    does not have (for example Chinese or Japanese) show as blank boxes; that
    is accepted for now and written in INSTALL.md.
  - `fflate` for zip files.
  The coder may pick a different library only if it is pure JavaScript, has
  an open licence, and the lead agrees before it is added.
- **What can be exported.** One page, or one page **with all its live
  sub-pages** (every level down, in sidebar order). A page in the trash, a
  page under a trashed page, and every page in a trashed space are a 404,
  the same as opening them. A sub-page that is in the trash, and everything
  under it, is left out without a trace: no title, no empty heading, no
  contents line. Comments, page history, labels, follows and notifications
  are **not** exported.
- **Who can export.** Anyone who can read the page, viewers included
  (`requirePageRole(viewer)`). Someone who cannot read the space gets **404**,
  the same as for the page. Signed out is **401**. Pages in one space all
  share that space's permission, so a reader of the top page can read every
  live page under it.
- **Files and images: only what the user may read, only from our own
  storage.** Every image, file and uploaded video in the export goes through
  `readableAttachment(db, user, id)`. One that is not readable (another
  space the user cannot see, a page in the trash, deleted) is left out and
  shown as a plain line "Image not available" / "File not available". The
  server **never fetches anything from the internet** while exporting: a
  link preview's picture and an embedded video stay links. This keeps export
  free of outside requests (the same caution as the link-preview fetcher).
- **Markdown.**
  - One page with no readable files → one `<title>.md` file.
  - One page with files, or any export with sub-pages → one `<title>.zip`.
    In it each page is a `.md` file named from its title (lower-case,
    spaces to `-`, unsafe characters dropped, empty → `untitled`, a clash gets
    `-2`, `-3`, …). A page with sub-pages also gets a folder of the same name
    holding them. Files sit in `attachments/<attachment id>-<clean file
    name>` and every link to them is relative, so the zip opens offline in any
    Markdown editor.
  - Each file starts with `# <page title>`. Then: headings as `#`, `##`,
    `###` (one level down, under the title); bold, italic, strike, inline
    code and links as usual GitHub-style Markdown; bullet and numbered lists
    with nesting; task items as `- [ ]` / `- [x]`, followed by `@Name` for the
    assignee and the due date when set; quotes as `>`; a divider as `---`;
    code blocks fenced with their language; tables as GitHub tables (first row
    is the header; a cell with several blocks has them joined with `<br>`;
    `|` in a cell is escaped); a callout as a quote whose first line is its
    tone in bold (`> **Note**`, `> **Tip**`, `> **Warning**`, `> **Caution**`
    for info, success, warning, danger); an image as `![alt or
    caption](attachments/…)` with the caption on the next line in italics; a
    file as a link with its name and size; a video as a link to the file or
    the video address; a link preview as `[title](url)` and its description
    on the next line; a mention as `@` and the person's current name (the
    saved label if the person is gone).
  - Text that looks like Markdown or HTML is escaped so it stays text.
  - A link in the page to another page of the wiki points to that page's
    `.md` file when that page is in the same export, and otherwise to the full
    wiki address (`publicUrl` + `/s/:key/p/:id`), which still needs sign-in.
- **PDF.**
  - Always one `<title>.pdf`. A4, generous margins, the app's calm light
    look: soft near-black text, quiet grey for captions, code on a soft tint
    in a monospace font, callouts as a soft tinted box with the tone word,
    tables with thin soft lines. Always light, also when the user is in dark
    mode (it is for reading and printing).
  - With sub-pages: a short contents list on the first page, then each page
    starts on a new PDF page with its title, in sidebar order, nested pages
    indented in the contents.
  - Each page's title is followed by a small grey line: space name and
    "Exported <date> by <name>". Page numbers at the bottom.
  - Same content as Markdown. PNG and JPEG images are drawn in, no wider than
    the text column. Other image types (GIF, WebP, SVG) and videos show as a
    named line with the file name. Files show their name and size. Links stay
    clickable.
  - Names, headings and text are taken from the document, never from the
    file names, and never run as HTML.
- **Limits, so one export cannot take the server down.** At most **200 pages**
  and **100 MB of files** in one export. Above that: **413** with a plain
  message ("This export is too large: 230 pages, the limit is 200. Export a
  smaller part of the tree."), checked before any file is built. The export
  is built in memory and sent in one answer; no background job, no file left
  on disk.
- **The route.** `GET /api/pages/:id/export?format=md|pdf&children=0|1`
  (`children` defaults to 0). A wrong `format` is 400. The answer has the
  right content type (`text/markdown; charset=utf-8`, `application/zip`,
  `application/pdf`), `content-disposition: attachment` with a safe file name
  from `contentDisposition`, and `cache-control: no-store`. `GET
  /api/pages/:id` gains `childCount` (the number of live direct sub-pages)
  so the screen knows whether to offer "with sub-pages". The download is a
  plain link: the browser's own sign-in cookie is enough, no script holds the
  file.
- **Why co-editing can still be added without a rewrite.** Export only reads
  the saved document through the one schema. A co-editing server still saves
  through `savePage` into `pages.doc`, so export reads the same thing with no
  change. Export writes nothing, so it can never clash with anyone editing.
- **Not in this feature:** exporting a whole space, Word or HTML export,
  import of any kind, exporting comments or history, scheduled or emailed
  exports, fonts for scripts Roboto does not cover, a progress bar for big
  exports.

---

## 16a — Server

### Build
- [x] `apps/server/src/export/markdown.ts` (doc → Markdown, and the zip),
      `apps/server/src/export/pdf.ts` (doc → PDF) and
      `apps/server/src/export/collect.ts` (the page walk, the permission
      check, the file reads, the limits). Route in
      `apps/server/src/routes/export.ts`. No export code writes any table.
- [ ] `pdfmake` and `fflate` in `apps/server/package.json` only, with the
      lock file updated; `docker compose build` still builds (the self-host
      engineer confirms).
      *Lead, item #171: first half holds (`pdfmake` ^0.3.14 and `fflate`
      ^0.8.3 in `apps/server/package.json` only, `@types/pdfmake` as a dev
      dependency, lock file updated; no other package.json touched). **Open
      only for** the self-host engineer's `docker compose build` run, which
      nobody has made yet.*
      *Self-host engineer, item #172 (2026-11-12): **`docker compose build`
      and `scripts/smoke.sh` could NOT be run, so this box stays open.**
      `docker compose build` says "Cannot connect to the Docker daemon at
      unix:///var/run/docker.sock" (the socket is cut off inside this
      workspace's sandbox, as in every earlier round; `docker compose config
      -q` exits 0). What I ran instead, so the owner or the lead's machine
      has less to find: (1) the Dockerfile's prod-deps step copied exactly
      (only server, shared and editor-schema package.json, `npm install
      --omit=dev` from the committed lock file) installs `pdfmake` and
      `fflate`, `require('pdfmake')`, `pdfmake/fonts/Roboto.js` and
      `fflate` all load; (2) full `npm run build` exit 0; (3) the real built
      server on a throwaway Postgres (`scripts/local-start.mjs`, migrations
      run on start): `/health` ok; admin signs up, makes a space and a page,
      adds a viewer; signed in as the **viewer**, `GET
      /api/pages/:id/export?format=md` gave 200 text/markdown with
      `# Export me / ## Hello / Plain **bold**`, `format=pdf` gave 200
      application/pdf, 15270 bytes, first bytes `%PDF-1.3`; signed out, both
      gave 401. Throwaway data removed. This is not the real image: the
      Alpine image and `smoke.sh` still need one run where a Docker daemon
      is reachable.*
- [x] Shared types in `packages/shared/src/index.ts` for the export format
      and the new `childCount` on the page.
- [x] The route and `childCount` as in Decisions (signed out → 401).

### Checks that must exist and pass — `apps/server/test/export.test.ts` (Vitest, real Postgres)
- [x] Markdown content: one page holding every node type (each heading level,
      every mark, nested lists, a task list with a ticked item, an assignee and
      a due date, a quote, a divider, a code block with a language, a table
      with a `|` in a cell and a cell with two paragraphs, all four callout
      tones, an image with a caption, a file, an uploaded video, a video
      address, a link preview, a mention) gives the Markdown written in
      Decisions, line for line, checked against a fixed expected text.
- [x] Escaping: page text `**not bold** <b>x</b> # not a heading` comes out as
      text, not as Markdown or HTML.
- [x] Single file or zip: a page with no files is one `.md` with
      `text/markdown`; a page with an image is a `.zip` holding the `.md` and
      `attachments/<id>-<name>` with the same bytes as uploaded, and the `.md`
      links to it with a relative path. Two sibling pages with the same title
      get two different file names.
- [x] Sub-pages: a tree A → B → C and A → D, in a set order. `children=1` on
      A has A, B, C and D in sidebar order and nested folders. `children=0`
      has only A. A link in A to D points to D's `.md`; a link to a page
      outside the export points to the full wiki address.
- [x] Trash: trash B. Exporting A with sub-pages has A and D only, and
      neither B's nor C's title or text appears anywhere in the zip or the
      PDF. Exporting B or C directly is 404. Restore B: it is back. Trashing
      the space makes every export in it 404.
- [x] Permissions: in a restricted space, a viewer member can export (200),
      an editor who is not a member gets 404, signed out gets 401. An image in
      A whose attachment belongs to a page in a space the exporting user cannot
      read is left out and shows "Image not available", and its bytes are not
      in the zip.
- [x] No outside fetch: with a link preview that has an `imageUrl`, the export
      makes no outgoing request (the test fails if the fetcher is called).
- [x] PDF: the answer is `application/pdf`, starts with `%PDF-`, and (built
      uncompressed in the test, or read back with a text extractor) contains
      every page title, the space name and the text of each block in order,
      and none of B's or C's text after B is trashed. A PNG and a JPEG image
      are drawn; a GIF shows its file name line. A tree export has the
      contents list and starts each page on a new PDF page.
- [x] Limits: 201 pages under one page gives 413 with the plain message before
      any file is built (made with a lower limit through a test setting is
      fine); files over the size limit, the same.
- [x] Read-only: `pages.version`, `pages.updated_at` and the count of
      `page_versions` are the same before and after every export.
- [x] Headers: content type per format, `content-disposition: attachment`
      with a safe name for a title like `../Plan "Q4"/é`, `cache-control:
      no-store`. `format=docx` is 400.
- [x] `npm run check` passes (this file is part of it), and the originality
      scan (c5) passes on the new code and texts.
      *Lead's run, item #171, Node 22: exit 0, 24 files, 431 tests passed,
      `export.test.ts` 15 of 15, "ORIGINAL OK", 2:52.96 wall time, load
      4.42 / 2.40 / 3.35 at the start and 8.34 / 4.87 / 4.13 at the end. Raw
      log: `docs/done-checks/logs/16-export-check-171.txt`.*

---

### Coder's note, item #170 (2026-11-12) — boxes above are for the lead to tick
- Built: `apps/server/src/export/collect.ts` (walk, permission, files,
  limits), `markdown.ts` (Markdown and zip), `pdf.ts` (PDF),
  `apps/server/src/routes/export.ts`; `childCount` on `GET /api/pages/:id`;
  `exportQuery`, `ExportFormat`, the two limits and `Page.childCount` in
  `packages/shared`. `pdfmake` 0.3.14 and `fflate` 0.8.3 (both MIT) in
  `apps/server` only, plus `@types/pdfmake` as a dev dependency.
- pdfmake is told to fetch no URL at all and to read only its own Roboto
  files. Code uses the PDF standard Courier font (built into every reader,
  nothing to load); code with characters Courier lacks falls back to Roboto.
  If an image cannot be drawn, the PDF is made again with images as named
  lines, so one broken upload never fails the export.
- Markdown choices the Decisions left open: a task's assignee and due date are
  written ` — @Name, due YYYY-MM-DD`; a file is `[name](attachments/…) (size)`;
  an uploaded video is `[Video: name](attachments/…)`, an address
  `[Video](url)`; an unreadable video is "Video not available". Captions and
  link-card descriptions are their own paragraph under the block.
- Test settings: `buildApp({ exportOptions: { limits, pdfCompress } })`. The
  tests read PDF text back through the fonts' ToUnicode maps (no new library).
- `apps/server/test/export.test.ts`: 15 tests, all passing. `npm run check`
  exit 0 on Node 22 (24 files, 431 tests, 117.6 s). `docker compose build`
  not run by me (self-host engineer's box). INSTALL.md has an "Export" section
  with the blank-box note.

### Lead's acceptance of 16a, item #171 (2026-11-12)
**16a is accepted. 16b may start.** I read the whole diff of `801244bc7`
against the Decisions, and ran `npm run check` myself (exit 0, log above).
15 of the 16 boxes in 16a are ticked. The one still open is the
`docker compose build` half of the dependency box, which is the self-host
engineer's run. It does not hold back 16b, but it has to be done before the
lead check.

What I checked in the code:
- **One permission path.** `collectExport` starts with
  `requirePageRole(viewer)`, so a trashed page or space, or a space the
  user can't read, gives 404. The route uses `requireUser`, so a signed-out
  request gets 401. The sub-page walk stays inside the same space.
- **The walk stops at trash.** The recursive query only goes into children
  with `deleted_at is null`, so a trashed branch is left out entirely.
- **Files.** Every attachment id in the document goes through
  `readableAttachment`. Anything that fails it is shown as "… not
  available", and its bytes are never read.
- **No outside fetch.** pdfmake's URL policy refuses every address, and its
  local policy allows only the Roboto folder and the built-in Courier font.
  Link-preview pictures and video addresses stay as links. The test spies
  on `fetch`, `http` and `https` and on the link-preview fetcher.
- **Read-only.** There is no insert, update or delete anywhere in
  `export/` or `routes/export.ts`. The test compares the page versions,
  `updated_at`, the document and the `page_versions` count before and after
  every export of every page.
- **Limits.** The page count is checked straight after the walk, before any
  document is parsed. The file total is checked from the stored sizes,
  before any bytes are read. The test spies on `storage.get` to prove this.
- **The Markdown and PDF match the Decisions.** The coder's choices where
  the Decisions left room (the coder's note above) are fine and are now part
  of the spec:
  - page headings sit one level under the title (H1 becomes `##`);
  - an assignee and due date are written as ` — @Name, due …`.

One small note for 16b, not a gap: in the PDF, file and video links point
to `<publicUrl>/api/attachments/:id`, which is a real route and still needs
sign-in. That is right, but the hand check should click one to confirm it.

## 16b — Screen

### Build
- [x] An **Export** button on the page, next to Follow and the favourite
      star, for everyone who can read the page (viewers included). It opens
      a small menu: "Markdown" and "PDF", and, only when `childCount` is more
      than 0, a choice "This page only" / "This page and its N sub-pages".
      Picking one downloads the file through a plain link. Keyboard works
      (arrows, Enter, Escape closes with focus back on the button), and the
      menu has proper labels for screen readers.
- [x] A 413 shows the server's plain message as a quiet note, not an error
      page. Other failures show a short quiet note too.
- [x] Styles use only the design tokens. Light and dark both look right.
      Motion is soft and short and turns off under `prefers-reduced-motion`.
      Text and controls pass the contrast check (c6).
- [x] Nothing in the new code or text uses another product's names or assets
      (the originality scan, c5, passes).

### Coder's note, item #174 (2026-11-12) — Build boxes above are for the lead to tick
- Built: `apps/web/src/export/ExportMenu.tsx` (button and menu), placed in
  the page header right after Follow and the star
  (`apps/web/src/screens/PageScreen.tsx`); `api.exportUrl` and
  `api.checkExport` in `apps/web/src/api.ts`; styles at the end of the
  Follow block in `apps/web/src/styles/app.css` (tokens only; the menu reuses
  `.menu` and its existing soft fade, which the one reduced-motion rule in
  `tokens.css` turns off).
- **One small server addition, needed for the 413 box.** A plain link that
  meets a 413 shows the browser's own failed download or the raw error, not
  a quiet note. So picking a format first asks
  `GET /api/pages/:id/export?…&check=1`: the same permission walk and both
  limits as the real export, but no file byte read and nothing built; it
  answers 204 (or the same 404 / 413 / 401). Only then the file comes
  through a plain `<a download>` link, with the sign-in cookie; no script
  holds the file. `checkExport` in `export/collect.ts` shares the walk with
  `collectExport` (split into `planExport`), `check` added to `exportQuery`
  in `packages/shared`. New server test in `export.test.ts` (now 16): 413
  with the plain message, 204 with no body and no `content-disposition`,
  404 for a non-member, 401 signed out, `check=2` is 400, and no file read.
- Menu: "This page only" / "This page and its N sub-page(s)" as two
  `menuitemradio` rows (shown only when `childCount` > 0, "This page only"
  chosen by default), a separator, then "Markdown" and "PDF" as `menuitem`s.
  Menu labelled "Export this page", groups "What to export" and "Download
  as". Wording choice: **"1 sub-page"** singular, "2 sub-pages" plural (the
  box text says "1 sub-pages"; the test can match `/This page and its 1
  sub-page/`). Keyboard: Arrow down on the button opens it; opening puts
  focus on the first item; arrows wrap, Home/End; Enter/Space picks;
  Escape closes with focus back on the button; Tab or a click outside
  closes. While the check runs the button reads "Preparing…".
- Notes: a 413 shows the server's message as a quiet `.note` under the
  header with a Dismiss button (stays until dismissed or the next export);
  a 404 says the page can't be exported any more; anything else "Couldn't
  prepare the export. Try again in a moment."
- How I checked: a scratch Playwright spec (deleted, not committed) as a
  **viewer**: menu shows both scopes; PDF with the sub-page → `.pdf`
  starting `%PDF-`; Markdown by keyboard only → `.zip` with `field-notes.md`
  and `field-notes/low-tide.md`; Escape returns focus; a faked 413 shows the
  plain message, Dismiss removes it; a faked 500 shows the short note; a
  page with no sub-pages has no scope rows and gives `Lone page.md`.
  Screenshots in light and dark looked calm and soft. `npm run check` exit 0
  (432 tests, export 16/16, ORIGINAL OK, contrast 58 pairs ok);
  `npm run test:e2e` exit 0, 26 passed, 1.4 min (load 9.60 at start, 16.51
  at end). The e2e export test itself is the tester's.

### Lead check of item #174 (2026-11-12) — the four 16b Build boxes ticked
- Read the whole diff of `1dd1c19ca`. The menu, keyboard handling (arrows
  wrap, Home/End, Enter/Space, Escape back to the button, Tab closes), labels
  ("Export this page", "What to export", "Download as") and the scope rows
  (only when `childCount` > 0) match the first box. The download is a plain
  `<a download>` link after the check.
- `check=1` is accepted. It goes through the same `planExport` (one
  permission path, the same walk and both limits) and reads no file bytes; the
  new server test proves 413/204/404/401/400. Nothing else changed in the
  export.
- Styles: only tokens (`--color-focus-ring`, `--color-bg-subtle`,
  `--color-border`, `--space-*`), and the menu reuses `.menu` and its fade,
  which the one reduced-motion rule turns off. How it looks in both themes is
  checked again by hand in the hand check below.
- Ran `npm run check` myself (load 9.92 at the start, 4.91 at the end): exit 0,
  432 tests, export 16/16, ORIGINAL OK, 58 contrast pairs ok. Log:
  `docs/done-checks/logs/16-export-lead-check-174.txt`.
- "1 sub-page" in the singular is accepted. The e2e test should match
  `/This page and its 1 sub-page/`.
- Still open: the e2e boxes (tester), the hand check, the docker run, and the
  push (still waiting on the owner for a GitHub address).

### Check that must exist and pass — e2e (Playwright)
**Time cost of this feature's browser tests: at most one short test, in an
existing file.** `e2e/tests/` already has 18 files, done-check 10's limit, so
export adds **no new file**: the test goes into an existing file (the tester
picks `viewer.spec.ts` or `wiki.spec.ts`, whichever has the right set-up
already). All set-up (people, space, pages, sub-pages, an image) goes through
the API in `e2e/login.ts`. The test must be **no slower than the middle test
of the same run**, in Playwright's per-test output, and the run must exit 0.
(Rule changed in item #171, 2026-11-12, to match mentions (done-check 15,
item #169). It was "at most 5 s". A fixed number of seconds cannot tell a
slow test from a slow machine; comparing the export test with the other tests
of the same run can. "Middle test": sort the run's tests from fastest to
slowest; with 27 tests the middle is the 14th.) Everything the 16a boxes
prove stays proved by the server tests; the browser test proves only what
only a browser can.
- [ ] Before 16b's test is added, the tester makes three timed
      `/usr/bin/time npm run test:e2e` runs of the current 26-test suite and
      writes them here with load at the start and end, so the cost of the new
      test can be seen.
- [ ] One test: a **viewer** opens a page that has one sub-page, opens Export,
      sees both choices, picks "PDF" with "This page and its 1 sub-pages",
      and gets a download whose name ends in `.pdf` and whose first bytes are
      `%PDF-`; then picks "Markdown" and gets a `.zip` that holds two `.md`
      files.
- [ ] `npm run test:e2e` passes in full: 26 + 1 = 27 tests, no retries, no
      skips, no `.only`.
- [ ] Time, under done-check 10's rule as rewritten in item #147: at least
      three timed `/usr/bin/time npm run test:e2e` runs by the tester with the
      export test in the suite, load noted at the start and end of each,
      **every run passes with exit 0 and the middle run is under 95 s**. The
      slowest runs are listed against the checker's ~110 s limit, and the
      export test's own time **and its rank among the 27 tests** are written
      down for every run, next to the time of the middle test (the 14th
      fastest). If the middle run is 95 s or more, or any run fails, or the
      export test is slower than the middle test of the same run in any run,
      the box stays open and the export test is cut back first; no limit is
      raised and no other test is dropped to make room. (Item #171: the
      per-test rule was "over 5 s"; it is now the mentions rule, as in the
      paragraph above these boxes.) If the machine is so
      loaded that the test servers do not start (as in #165), that run is
      written down and does not count either way; it is run again when the
      load is normal.

---

## Hand check (lead, in a browser, both themes)
- [ ] As admin: an open space and a restricted space. In the restricted space
      a page "Field notes" with two levels of sub-pages, holding headings,
      lists, a task list with an assignee, a table, a code block, a callout,
      a PNG image, a GIF, a file, a video address, a link preview and a
      mention. An editor and a viewer who are members, and an outsider who is
      not.
- [ ] As the viewer: export "Field notes" alone and with sub-pages, both
      formats. Open the PDF: it is calm and readable, the contents list is
      right, each page starts on a new sheet, the image is in, the links work.
      Open the zip in a Markdown viewer offline: the folders match the tree,
      the image shows, links between pages work.
- [ ] Trash one sub-page: export with sub-pages again; it and everything
      under it are gone from both files, with no trace of their titles.
      Restore it: it is back.
- [ ] As the outsider: the page and its export link are 404.
- [ ] A second tab with the page open saves with no conflict note after the
      exports (export never touches the page's version).
- [ ] Light and dark: the button and menu are calm and soft; the PDF is light
      in both. Motion is quiet, and with reduced motion turned on it is
      instant. Keyboard alone can export.

## Lead check
- [ ] Read the diff myself: one permission path; the page walk stops at
      trashed pages; every file goes through `readableAttachment`; no outside
      fetch; no export code writes any table; the Markdown and PDF match the
      Decisions; the limits are checked before building.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself, timed: all passed, exit 0, count, time
      and load noted here, and my run is added to the time record above.
- [ ] Hand check above done and ticked.
- [ ] `docker compose build` and the smoke script still pass with the two new
      dependencies (self-host engineer's run, read back by the lead).
- [ ] ARCHITECTURE.md gets a short "Export" section (section 20): export is
      read-only from the saved document through the one schema, files only
      through `readableAttachment`, trashed branches left out, no outside
      fetch, the limits, and why co-editing can still be added.
- [ ] Committed on `master` and pushed to GitHub, as the owner asked. While
      the workspace has no GitHub address, this box stays open and says it is
      waiting on the owner; it does not hold back single-page locks (rule of
      item #165).
- [ ] Lead sign-off written here. Single-page locks start only after it.
