# Stillwater — the calm visual system

Owned by the designer. This is how every screen stays calm, soft and
spacious in both themes. The tokens themselves are in
`apps/web/src/styles/tokens.css` — import that file once, at the app root,
before any component CSS.

## Rules for anyone building a screen

1. **No hard-coded colour, size or duration.** Use a `var(--token)` from
   `tokens.css`. If the token you need doesn't exist, ask the designer to
   add it rather than inventing a one-off value.
2. **Space generously.** Use the `--space-*` scale (4px steps: 4, 8, 12,
   16, 24, 32, 48, 64, 96). Default to one size larger than feels tight —
   the calm comes from air around things, not from fitting more in.
3. **Soft edges, soft shadows.** `--radius-md` (10px) for cards and
   inputs, `--radius-lg` (16px) for panels/modals, `--radius-full` for
   pills and avatars. Shadows are shallow (`--shadow-sm/md/lg`) — never a
   hard drop shadow or a bright glow.
4. **Motion is short, quiet and skippable.** Use `--motion-fast` (140ms)
   for hovers/toggles, `--motion-base` (200ms) for panels and menus
   opening, `--motion-slow` (320ms) only for page-level transitions. Pair
   with `--ease-standard` (or `--ease-enter`/`--ease-exit` for things that
   appear/disappear). Nothing animates longer than 320ms. `tokens.css`
   already turns all of this off under `prefers-reduced-motion: reduce` —
   don't add a second check in the component.
5. **Theme by attribute, not by class per element.** Put
   `data-theme="light"` or `data-theme="dark"` on `<html>` once; every
   token switches underneath. Components never branch on theme in JS.
6. **Text colour follows the surface it sits on**, not a fixed value:
   `--color-text` on `--color-bg`/`--color-surface`, `--color-text-muted`
   for secondary text, `--color-text-on-accent` on filled accent buttons.
   `--color-text-faint` is for icons, dividers and large display text
   only — it does not clear AA for small body text.

## Contrast

`node scripts/check-contrast.mjs` reads the token file and checks every
text/background pair the app actually uses against WCAG AA (4.5:1 normal
text, 3:1 large text/icons) in both themes. Run it after touching any
colour in `tokens.css`; it's part of `npm run check` (stage 5 done-check in
ARCHITECTURE.md §12).

## Component patterns already in `apps/web/src/styles/app.css`

Reuse these instead of inventing new classes — that's the point of a
calm *system*. Non-exhaustive, just the ones worth knowing before adding
a screen:

- **Buttons.** `.btn-primary` for the one confirming action in a form or
  modal. `.btn-quiet` for everything else, including toggle buttons that
  show a panel or a state (History, Comments, Summarise all use it) —
  add `.is-on` while the thing it opens or marks is active
  (`background`/`border-color: var(--color-accent-soft)`). Pair `.is-on`
  with `aria-expanded` for a panel toggle or `aria-pressed` for a state
  toggle (starred, bookmarked, etc.) — same visual, correct semantics.
  `.icon-btn` is for an icon-only action with no on/off state (delete,
  menu) — give it `aria-label`.
- **Lists of pages/items.** `.list` + `.list-link` rows (used in Space's
  page list) — flush, no border, background tint on hover only. This is
  the pattern for any "titles with a bit of metadata" list; don't reach
  for `.cards` (space picker grid) or `.result`/`.results` (search, which
  carries a snippet) unless the content actually needs that much room.
- **Empty state, two sizes.** `.empty` is the heavy, centred, dashed-box
  treatment for a whole screen or panel with nothing in it yet (e.g. a
  space with no pages). For a short aside inside a page that's otherwise
  not empty (a quiet section with nothing to show today), don't use
  `.empty` — one `<p class="muted small">` line in its place is calm
  enough and doesn't compete with real content above or below it.
- **Cards** (`.cards`/`.card`) for things you navigate into (spaces).
  **Panels** (`.panel`) for a boxed group of settings or members.
  **Modals** (`.overlay`/`.modal`) for a focused task that blocks the
  page. **Tabs** (`.tabs`/`.tab`, `.is-on`) for switching views of the
  same settings screen.
- New motion always follows an existing keyframe shape (`fade-in` for
  content appearing in place, `panel-in`/`panel-out` for a side panel,
  `modal-in`/`overlay-in` for a modal) at `--motion-fast`/`base`/`slow` —
  don't write a new easing curve or a longer duration.

If a screen needs something none of the above covers, add the class to
`app.css` following rule 1–4 above and note it here in a one-line
comment block (see the `/* ---- Page templates ---- */` style already
in the file) — don't let new component CSS live undocumented.
