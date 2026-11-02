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

## What's still open

Component-level CSS (buttons, inputs, menus, the editor chrome) isn't
built yet — `apps/web` doesn't exist until the coder scaffolds it. Once it
does, those components should consume these tokens rather than any new
ones, and this file is where I'll add component patterns as they're built.
