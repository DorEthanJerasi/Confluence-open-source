# Done-check 08: page templates

Owner of this check: Wiki Lead. Written 2026-11-08 (item #111).
This is feature 2 of 3 in the order the owner picked (option b): comments (07,
accepted), then **page templates**, then favourites and recently viewed (09).
Favourites do not start until every box below is ticked, the work is committed,
and `npm run check` and `npm run test:e2e` pass.

The work is split into **two items** so each one fits in a single run (big
items have timed out before):

- **8a** server: table, migration, built-in templates, routes, API tests.
- **8b** screen: template picker, "Save as template", the Templates tab in
  space settings, e2e.

8b starts only after the lead has accepted 8a.

The lead ticks a box only after seeing it in the workspace: a test that runs
and passes, or a hand check in a browser. "The code is there" does not count.
Run everything with Node 22 (`PATH=~/.local/node22/bin:$PATH`).

What already exists (do not rebuild it): `createPage(db, { spaceId, userId,
title, parentId, doc })` in `apps/server/src/pages/pages.ts` already takes a
doc. `normalizeDoc(doc)` in `apps/server/src/pages/docText.ts` checks a body
against the one editor schema and fills in missing top-level block ids.
`requireSpaceByKey(db, user, key, role)` in `apps/server/src/auth/permissions.ts`
gives 404 to people who cannot see the space. `createPageBody` and `docSchema`
are in `@stillwater/shared`. The editor is `apps/web/src/editor/PageEditor.tsx`
with `getExtensions()` from `@stillwater/editor-schema`. "New page" buttons are
in `apps/web/src/screens/Space.tsx` and `PageScreen.tsx`. The e2e set-up
helpers (`signUp`, `createSpace`, `createPage`, `addPerson`) are in
`e2e/login.ts`.

---

## Decisions (the lead's, fixed for this feature)

- **A template body is the same document as a page body.** It is ProseMirror
  JSON in the shape `pages.doc` uses, checked by the same `normalizeDoc`
  against the same `getExtensions()` schema, and edited in the same block
  editor. There is no second format, no HTML and no Markdown. So anything a
  page can hold (slash-menu blocks, tables, code, images, files, video, link
  previews) a template can hold, and nothing else.
- **A new page is a copy, not a link.** Making a page from a template copies the
  template's doc into a new page through `createPage`. The page does not point
  back to the template. Changing or deleting the template later never changes
  pages already made from it. The new page starts at version 1 with one history
  row, like any new page.
- **Fresh block ids on every copy.** When a page is made from a template, and
  when a page is saved as a template, every top-level `attrs.id` is replaced
  with a new UUID. No two pages share a block id, so comment anchors and
  history diffs (which use block ids) never cross between pages.
- **Two kinds of template.**
  - **Built-in:** a short set shipped with the app, written in our own words:
    *Meeting notes*, *Project brief*, *How-to guide*, *Decision record*. They
    live in code (`apps/server/src/templates/builtin.ts`), not in the database,
    so there is nothing to seed and an upgrade can improve them. Their ids are
    fixed strings `builtin:<slug>` (e.g. `builtin:meeting-notes`). They show in
    every space. Nobody can edit or delete them.
  - **Space template:** made by people in one space, stored in the
    `page_templates` table, shown and usable only in that space. Images and
    files in it are that space's attachments, so a copy never points at a file
    in another space.
- **Who can do what** (the role is the user's effective role in the space, from
  `requireSpaceByKey`):

  | action | viewer | editor | space admin / instance admin |
  |---|---|---|---|
  | list and preview templates | no (403) | yes | yes |
  | new page from a template | no (403, same as any new page) | yes | yes |
  | save a page as a template | no (403) | yes | yes |
  | create, edit, delete a space template | no (403) | yes | yes |
  | edit or delete a built-in | no | no (403) | no (403) |

  Someone who cannot see the space gets **404** on every template route, the
  same as for the space itself. Viewers cannot make pages, so templates are of
  no use to them and they are not shown any template control.
- **Name and description.** Name: trimmed, 1 to 80 characters, unique in its
  space ignoring case (a clash gives 409). A name the same as a built-in's is
  allowed (the picker labels built-ins). Description: trimmed, 0 to 200
  characters, plain text. Both always shown as text, never as HTML.
- **Stale edits are refused, as for pages.** A template has a `version`.
  `PATCH` sends `baseVersion`. A stale one gives 409 and the screen offers a
  reload. One person edits a template at a time; templates are not co-edited.
- **Templates are not pages.** They are not in the page tree, search results,
  AI summaries or AI answers, and they have no history. Deleting a template is
  a real delete (with a confirm on screen). Deleting a space deletes its
  templates (cascade). Deleting a page does not touch templates saved from it.
- **Ready for co-editing.** Templates do not use `pages.ydoc_state` and need no
  Y.Doc. When co-editing comes, a page made from a template is seeded from the
  copied JSON like any other page, so the templates table and routes need no
  change.
- **Not in this feature:** hiding or reordering built-ins, templates shared
  across spaces, template variables (such as today's date filled in), template
  categories, a page title taken from the template.

## Table (migration `0005_page_templates`, runs on start like the others)

`page_templates`:
`id` uuid pk default `gen_random_uuid()` ·
`space_id` uuid not null → `spaces.id` on delete cascade ·
`name` text not null ·
`description` text not null default `''` ·
`doc` jsonb not null (same type as `pages.doc`) ·
`version` int not null default 1 ·
`created_by` uuid null → `users.id` on delete set null ·
`updated_by` uuid null → `users.id` on delete set null ·
`created_at` timestamptz not null default now() ·
`updated_at` timestamptz not null default now().
Unique index `page_templates_space_name_idx` on `(space_id, lower(name))`.

---

## 8a — Server

### Build
- [x] Drizzle table `pageTemplates` in `apps/server/src/db/schema.ts` and
      migration `apps/server/drizzle/0005_page_templates.sql` (with its meta
      snapshot), exactly as in the Table section.
- [x] `apps/server/src/templates/builtin.ts` holds the four built-ins
      (`id`, `name`, `description`, `doc`), each a real starting structure
      (headings, lists, a table or callout where it helps), in our own words.
- [x] `apps/server/src/templates/templates.ts` holds all template logic. Every
      function checks access through `requireSpaceByKey`. There is no second
      permission rule. Every doc that is stored goes through `normalizeDoc`.
- [x] Routes (signed out → 401 on all of them; viewer → 403; cannot see the
      space → 404):
  - `GET /api/spaces/:key/templates` returns
    `{ templates: [{ id, name, description, builtIn, updatedAt, updatedBy:
    { id, name } | null }] }` with no docs. Built-ins first in a fixed order,
    then the space's own by name.
  - `GET /api/spaces/:key/templates/:id` returns `{ template: { id, name,
    description, builtIn, version, doc, ... } }` for a built-in or for a
    template of **this** space. Another space's template, or an unknown id,
    gives 404.
  - `POST /api/spaces/:key/templates` with `{ name, description?, doc }` or
    `{ name, description?, fromPageId }` returns 201 and the new template.
    `fromPageId` copies that page's current doc and must be a live page of
    **this** space (otherwise 400). Sending both `doc` and `fromPageId`, or
    neither, gives 400. Block ids in the stored doc are fresh.
  - `PATCH /api/spaces/:key/templates/:id` with `{ baseVersion, name?,
    description?, doc? }`: editor and up. Bumps `version`, sets `updated_by` and
    `updated_at`. Stale `baseVersion` → 409. A built-in id → 403.
  - `DELETE /api/spaces/:key/templates/:id`: editor and up. Returns 204. A
    built-in id → 403.
  - `POST /api/spaces/:key/pages` also takes `templateId` (a built-in or a
    template of this space). The new page's doc is a copy of the template's
    with fresh block ids. `templateId` with `doc` gives 400. An unknown id or
    another space's template gives 400. Without `templateId` it works as
    before.
- [x] Names and descriptions are checked as in Decisions. Unknown fields are
      refused. A doc the schema does not allow gives 400, as for pages.
- [x] No template route writes `pages`, `page_versions` or `pages.version`,
      except page creation through `createPage`.

### Checks that must exist and pass — `apps/server/test/templates.test.ts` (Vitest, real Postgres)
- [x] Every built-in passes `normalizeDoc` unchanged apart from block ids, and
      each has at least one heading and one more block.
- [x] An editor lists templates in a new space: the four built-ins, in order,
      with `builtIn: true` and no docs in the list.
- [x] An editor creates a template from a doc (heading, task list, table, code
      block) and another from a page (`fromPageId`). Both are listed and
      `GET` returns their docs. The one from a page has the page's content
      with different block ids from the page.
- [x] New page from a built-in and from a space template: 201, the page's
      doc has the template's content, every top-level block id is new and
      unique, the page is at version 1 with one `page_versions` row.
- [x] Two pages made from the same template have no block id in common.
- [x] Editing a template (PATCH) bumps its version. A stale `baseVersion` →
      409. A page made from it earlier is unchanged. Deleting it → 204, it is
      gone from the list, and that page is still there and unchanged.
- [x] Duplicate name in the same space (any case) → 409. The same name in
      another space is fine. Empty name, name over 80, description over 200 →
      400. A doc with an unknown node type → 400.
- [x] A space's template is 404 from another space (GET, PATCH, DELETE) and
      400 as `templateId` there. `fromPageId` naming a page in another space →
      400.
- [x] Built-in: PATCH and DELETE → 403 for an editor, a space admin and an
      instance admin.
- [x] Viewer of the space: 403 on list, get, create, edit, delete, and on
      creating a page with `templateId`.
- [x] Non-member of a restricted space: 404 on every template route. After
      they are added as an editor, they work. After they are removed, 404
      again.
- [x] A word that appears only in a template is not found by search, and a
      template's text is never in what AI ask retrieves.
- [x] Deleting the space removes its `page_templates` rows.
- [x] A template name of `<img src=x onerror=alert(1)>` comes back as the same
      text.
- [x] Signed out → 401 on every route.
- [x] `npm run check` passes (this file is part of it).

### Builder's record for 8a (p12-coder, 2026-11-09)
Built in `73453ed0`; checked this turn with Node 22.11.0, embedded Postgres:
- `npx vitest run test/templates.test.ts` in `apps/server`: 17 of 17 pass. Each
  box above has its own case in that file (names match the boxes).
- `drizzle-kit generate` against `src/db/schema.ts`: "No schema changes,
  nothing to migrate", so migration 0005 and its snapshot match the table.
- `npm run check`: exit 0, all 7 steps ok, server 335 of 335, editor-schema 11
  of 11, originality scan and contrast check ok.
Waiting for the lead's own run before 8b counts as started.

Re-checked for item #112 (p12-coder, 2026-11-09), no code changed since
`96cc33f1`: `npm run check` exit 0, all 7 steps ok, templates.test.ts 17 of 17
and server 335 of 335 against embedded Postgres; `drizzle-kit generate` still
says "No schema changes, nothing to migrate".

---

## 8b — Screen

### Build
- [ ] **Template picker.** Every "New page" and "Add a sub-page" control opens
      a quiet picker before the page is made: "Blank page" first and focused,
      then the built-ins (marked "Built in"), then the space's templates, each
      with its name and description. Choosing one shows a read-only preview of
      its content in the same editor styles. "Use template" (or Enter, or a
      double-click) makes the page and opens it in edit mode. "Blank page" keeps
      today's behaviour. Escape closes the picker and makes nothing.
- [ ] **Save as template.** Editors and up get "Save as template" on a page
      (in the page header, next to History and Comments, or in its "more"
      menu). It asks for a name and a short description, saves the page's
      current content, and shows a quiet confirmation. A name clash shows the
      server's message in the dialog.
- [ ] **Templates tab** in space settings, for editors and up: lists built-ins
      (with only "Preview") and the space's templates (with "Edit" and
      "Delete"). "New template" starts a blank one. Edit opens the template in
      the same block editor, with slash commands and embeds, plus its name and
      description. It saves with a Save button, not autosave, and handles a 409
      by offering a reload. Delete asks a quiet confirm first.
- [ ] Viewers see no template control anywhere: no picker (they have no "New
      page" today), no "Save as template", no Templates tab.
- [ ] Styles use only the design tokens (no raw colours, sizes or timings in the
      new CSS). Light and dark both look right. Motion is soft and short and
      turns off under `prefers-reduced-motion`. The picker and dialogs trap
      focus, can be used with the keyboard alone, and pass the contrast check
      (c6).
- [ ] Nothing in the new code, text or built-in templates uses another
      product's names or assets (the originality scan, c5, passes).

### Builder's record for 8b screens (p12-coder, item #113, 2026-11-09)
Boxes above are left for the lead to tick after their own look. What is built:
- Picker: `apps/web/src/templates/TemplatePicker.tsx`, opened by every "New
  page" (sidebar, space home) and "Add a sub-page" / "Sub-page" control
  through `newPage` in `screens/Space.tsx`. Blank page first and focused;
  arrows, Enter, double-click, Escape; preview is the read-only editor
  (`templates/TemplateDoc.tsx`, loaded lazily). Button reads "Create page"
  for Blank, "Use template" otherwise.
- Save as template: `templates/SaveAsTemplate.tsx`, a button in the page header
  for editors and up; it waits for pending autosave first, shows the server's
  message on a name clash, and a quiet "Saved as template" note after.
- Templates tab: `/s/:key/settings/templates` (`templates/TemplatesTab.tsx`,
  tabs in `screens/SpaceSettings.tsx`). Built-ins: Preview only. Space
  templates: Edit (same block editor, slash menu, Save button, 409 → Reload
  offer) and Delete (confirm). New template starts blank.
- Viewers: no picker, no Save as template, no Templates tab; the tab's URL
  sends them back to the General tab.
- `Modal` in `ui.tsx` now traps Tab/Shift+Tab, focuses once on open and gives
  focus back on close (every dialog gets this).
- Open point for the lead: **uploading a new image or file inside the
  template editor is refused with a note** ("add it to a page, then save that
  page as a template"), because `attachments.page_id` is NOT NULL and there is
  no page to keep the file on. Images and files that come in from a page
  (Save as template) show and copy fine. Allowing uploads straight into a
  template needs a schema decision (nullable `page_id` or a template id on
  attachments), which is the lead's call.
- The existing e2e specs that click "New page"/"Sub-page" now go through the
  picker's Blank page (`pickBlankPage` in `e2e/login.ts`). The new
  `templates.spec.ts` is item #115.

### Checks that must exist and pass — `e2e/tests/templates.spec.ts` (Playwright)
Set-up (people, space, a page with a heading and a table) goes through the API
helpers in `e2e/login.ts`. At most 3 tests, so the suite's time barely grows.
- [ ] An editor clicks "New page", picks *Meeting notes*, sees the preview,
      uses it: the new page opens with the template's headings. After a reload
      they are still there. "Blank page" still makes an empty page.
- [ ] An editor saves the set-up page as a template, then makes a new page from
      it: the heading and table are there. In the Templates tab they change the
      template's text and save; a page made from it now has the change, and the
      page made before does not. They delete the template and it is gone from
      the picker. This test is also checked once in dark mode.
- [ ] A viewer of the space opens it: no "New page", no "Save as template", no
      Templates tab.
- [ ] `npm run test:e2e` passes in full: 35 + the new tests, no retries, no
      skips, no `.only`.

---

## Hand check (lead, in a browser, both themes)
- [ ] Sign up as admin, add a space editor, a viewer of a restricted space and
      a non-member. As the editor: make a page from each built-in; each opens
      with sensible content and the editor works on it (slash menu, typing,
      autosave).
- [ ] Save a page that has an image, a code block and a table as a template.
      Make a page from it: the image shows, the code is highlighted, the table
      is there. Add a comment to a block of the new page; the source page has
      no marker on its matching block.
- [ ] Edit the template in the Templates tab (add a block with `/`), save,
      reload: the change stayed. A page made before is unchanged. Delete the
      template: the page made from it stays.
- [ ] Two tabs edit the same template; the second save gets the reload offer
      and loses nothing silently.
- [ ] As the viewer: no template controls. As the non-member: the space and
      its templates are not reachable (404 page; the API gives 404).
- [ ] Search for a word that is only in a template: nothing is found.
- [ ] Light and dark: the picker and dialogs are calm, spaced out, no harsh
      colours. Motion is quiet, and with reduced motion turned on it is
      instant. Everything works with the keyboard alone.

## Lead check (before favourites start)
- [ ] Read the diff myself: the table and routes match the Decisions and Table
      sections, there is one permission path (`requireSpaceByKey`), every
      stored doc goes through `normalizeDoc`, copies get fresh block ids, and
      no template code writes a page except through `createPage`.
- [ ] Ran `npm run check` myself: exit 0.
- [ ] Ran `npm run test:e2e` myself: all passed, exit 0, count noted here.
- [ ] Hand check above done and ticked.
- [ ] Committed on `master` and pushed if the workspace can reach GitHub (the
      owner said pushing is part of the brief; if there is still no remote,
      say so plainly in the record).
- [ ] ARCHITECTURE.md gets a short "Templates" section: the table, built-ins
      in code, copy with fresh block ids, and why it needs no change for
      co-editing. §12 gets a line pointing at this file.

### Lead's record
(Filled in at the lead check: commands run, exit codes, test counts, what the
hand check saw.)
