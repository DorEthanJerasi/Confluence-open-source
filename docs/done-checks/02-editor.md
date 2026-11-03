# Done-check — Stage 2: block editor with slash commands and embeds

Owner of this check: Wiki Lead. Build order position: 2 of 4 (stage 1, auth +
spaces + nested pages, was accepted as item #57).

The stage is split into **two items** so each fits inside one run (earlier
scaffold runs timed out when one item carried too much). 2b starts only after
2a is accepted.

A box is ticked only when the lead has seen it in the workspace: a test that
runs and passes, or a hand check in a browser against the compose stack.
"The code is there" is not enough.

Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

---

## 2a — The editor, the shared schema, slash menu, text blocks, code, tables, saving

### Build
- [x] New package `packages/editor-schema` exporting `getExtensions()`, the single
      list of Tiptap nodes and marks (ARCHITECTURE.md §3). The web editor and the
      server's `docToText` both import it. No node type is defined anywhere else.
- [x] A global attribute extension gives every top-level block a stable `id`
      (UUID). Splitting a block or pasting gives the new block a fresh id; no two
      blocks in one doc share an id.
- [x] Tiptap's History is turned on through one flag in one place, so it can be
      swapped for the Yjs undo manager later.
- [x] `PageScreen` shows the Tiptap editor for space editors/admins and a
      read-only render of the same schema for viewers (no editable surface, no
      slash menu, no toolbar).
- [x] Blocks: paragraph, heading 1–3, bullet list, numbered list, task list,
      quote, divider, callout, code block with syntax highlight (lowlight), table.
      Marks: bold, italic, strike, inline code, link.
- [x] `/` opens a menu at the caret listing every block above; typing filters it;
      arrow keys + Enter pick; Esc closes; picking replaces the `/query` text.
      Markdown shortcuts work for headings (`# `), lists (`- `, `1. `, `[] `),
      quote (`> `), code (```` ``` ````) and divider (`---`).
- [x] Table: insert from the slash menu as 3×3 with a header row; add and remove
      rows and columns from a small table menu.
- [x] Autosave: debounced ~1 s, sends full JSON plus `baseVersion` through the one
      `savePage` path. A quiet "Saving… / Saved" state is shown. On 409 the
      editor keeps the user's text, says plainly the page changed elsewhere, and
      offers **Reload** (and copying their text) — it never silently overwrites.
- [x] Server validates the incoming doc against the schema (`Node.fromJSON` on a
      schema built from `getExtensions()`); an unknown node type, a missing doc
      root, or any `data:` URL anywhere in attrs is a 400.
- [x] Editor styling uses the design tokens only (`apps/web/src/styles/tokens.css`):
      calm spacing, soft code/table/callout surfaces, slash menu fades in and
      respects `prefers-reduced-motion`. Light and dark both look right.

### Checks that must exist and pass
- [x] **Unit (server, Vitest):** `docToText` on a doc with every block type gives
      the expected text (code block and table cell text included, no attrs).
- [x] **Unit:** a doc with an unknown node, and one with a `data:` URL, are
      rejected with 400; a valid doc with every block type is accepted.
- [x] **API:** save with a stale `baseVersion` returns 409 and does not change the
      stored doc.
- [x] **E2E (Playwright), `e2e/tests/editor.spec.ts`:**
  - editor types text, waits for "Saved", reloads, the text is still there;
  - `/` then typing `head` filters to headings; Enter on "Heading 2" makes an `h2`;
  - every block in the list above can be inserted from the slash menu (one loop);
  - a code block with `const x = 1` shows highlight spans after reload;
  - a table is inserted, a row and a column are added then removed;
  - the stored doc (read via the API) has an `id` on every top-level block,
    all unique, and contains no `data:`;
  - a viewer opening the same page sees the content and has no editable surface;
  - two tabs edit the same page: the second save gets the 409 message and a
    Reload button, and its text is not lost before reload.
- [x] `npm run check` passes (typecheck, server tests, originality, contrast).

### Hand check by the lead (compose stack, browser)
- [ ] Write a page using the slash menu only, in light and dark mode; it feels
      calm (no jumpy motion, no harsh borders), and reloads intact.
      **Open:** this machine has no running Docker daemon, so the compose stack
      could not be started. Done instead on the same built app (the e2e server
      on embedded Postgres): light/dark screenshots and the slash menu look calm.
      Tick this together with the 2b compose check once Docker is available.

### Lead review, item #61 (2026-11-03)
2a accepted, with the one compose box above still open. Evidence:
- `npm run check` (Node 22): typecheck, 50 server tests, originality and contrast all pass.
  The server tests cover `docToText` for every block, 400 for an unknown node,
  an unknown mark, a missing doc root and `data:` URLs, and 409 on a stale `baseVersion`.
- `npm run test:e2e`: 8/8 pass (editor.spec 4, wiki.spec 4). That covers every item
  on the E2E list above.
- A one-off lead browser check (not committed) also passed: markdown shortcuts for
  `- `, `1. `, `[] `, `> `, ```` ``` ```` and `---`; bold, italic, strike and inline code
  survive a reload; splitting a paragraph gives the new block its own id; with
  reduced motion the slash menu opens with no animation.
- Code read: one node list in `packages/editor-schema` (no `Node.create` in the apps);
  History is behind the one `history` flag in `getExtensions`; autosave is 1000 ms;
  the conflict note offers Copy my text and Reload.

---

## 2b — Embeds: images, files, video, link previews

### Build
- [ ] Migration adds `attachments` and `link_previews` tables (ARCHITECTURE.md §4,
      new migration file; applied ones are not edited).
- [ ] `POST /api/pages/:id/attachments` (space editor or above), multipart, limit
      `MAX_UPLOAD_MB`; stores on disk under `/data/uploads` (the compose volume);
      returns `{ id, filename, mime, size }`.
- [ ] `GET /api/attachments/:id` streams the file only to a user who can read the
      attachment's space; anyone else gets 404. `Content-Type` from the stored
      mime, `Content-Disposition: attachment` for non-image/non-video, and
      `X-Content-Type-Options: nosniff`. SVG and HTML are never served inline.
- [ ] Nodes in `editor-schema`: `image`, `file`, `video`, `linkPreview` — attrs
      hold `attachmentId` or an allow-listed URL only, never file bytes.
- [ ] Image: slash menu, paste and drag-drop all upload, then render; optional
      caption. File: shows name, size and a download link. Video: upload (mp4/webm)
      plays in a `<video>`; a YouTube or Vimeo URL becomes an embedded player
      (privacy host `youtube-nocookie.com`); any other host is refused.
- [ ] Link preview: pasting a bare URL on an empty line offers "Show as preview
      card"; the card shows title, description, site name and image from Open
      Graph, fetched by the server and cached in `link_previews`.
- [ ] Link preview fetch: 5 s timeout, 1 MB cap, follows at most 3 redirects and
      re-checks each one, and refuses loopback, private, link-local and metadata
      addresses (IPv4 and IPv6, after DNS resolution). A refused or failed URL
      shows a plain link card, not an error page.
- [ ] Viewers see every embed; they cannot upload (no control, and the API says 403).

### Checks that must exist and pass
- [ ] **API:** upload then fetch works for a member; a non-member of a restricted
      space gets 404; a viewer's upload gets 403; a file over the limit gets 413.
- [ ] **Unit:** SSRF guard refuses `127.0.0.1`, `10.x`, `192.168.x`, `169.254.169.254`,
      `[::1]`, a hostname that resolves to a private address, and a redirect to one.
      Tests use a local stub server — no real internet in any test.
- [ ] **Unit:** YouTube/Vimeo URL parsing gives the embed URL; other hosts give null.
- [ ] **E2E, added to `e2e/tests/editor.spec.ts`:**
  - upload a PNG from the slash menu; after reload the image shows and its `src`
    is `/api/attachments/…`;
  - upload a PDF; after reload the file card shows its name and the download works;
  - paste a YouTube URL; an iframe to `youtube-nocookie.com` appears;
  - a link preview card renders from a local stub page with Open Graph tags
    (served by the test itself, not the internet);
  - a viewer sees the image and file but has no upload control;
  - the stored doc still has no `data:` anywhere.
- [ ] `docker compose up` from a clean checkout: an image uploaded before
      `docker compose restart` still shows after it (uploads volume works).
- [ ] `npm run check` passes.

### Hand check by the lead (compose stack, browser)
- [ ] Build a page with one of every embed, in light and dark mode; reload; all
      render; a second user who is not a member of the space cannot open the
      image URL directly.

---

## Which project criteria this stage moves
- c2 (e2e covers auth, permissions, **the editor and embeds**) — needs both 2a and 2b.
- c3 (unit and API tests) — the save/409, schema validation and upload tests.
- c5 (no other product's branding — `check-original` stays green) and c6 (contrast in both themes) — must
  stay green after the new editor styles.
