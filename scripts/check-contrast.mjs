#!/usr/bin/env node
// Contrast check for Stillwater's design tokens.
//
// Reads apps/web/src/styles/tokens.css, pulls the colour values out of
// `:root` (light) and `[data-theme='dark']` (dark), and checks that every
// text/background pair a real screen will show meets WCAG AA: 4.5:1 for
// normal text, 3:1 for large text / icons / UI chrome.
//
// Usage: node scripts/check-contrast.mjs

import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = join(ROOT, 'apps/web/src/styles/tokens.css');

// Pairs to check, by token name, with the WCAG level each must clear.
// 'AA' = 4.5:1 (normal text), 'AA-large' = 3:1 (large text, icons, borders
// of interactive controls).
const PAIRS = [
  ['color-text', 'color-bg', 'AA'],
  ['color-text', 'color-surface', 'AA'],
  ['color-text-muted', 'color-bg', 'AA'],
  ['color-text-muted', 'color-surface', 'AA'],
  ['color-text-faint', 'color-surface', 'AA-large'],
  ['color-accent', 'color-surface', 'AA'],
  ['color-accent-strong', 'color-surface', 'AA'],
  ['color-text-on-accent', 'color-accent', 'AA'],
  ['color-success', 'color-success-soft', 'AA'],
  ['color-warning', 'color-warning-soft', 'AA'],
  ['color-danger', 'color-danger-soft', 'AA'],
  ['color-danger', 'color-surface', 'AA'],
  ['color-text', 'color-bg-subtle', 'AA'],
  ['color-text', 'color-surface-sunken', 'AA'],
  // Editor (stage 2a): code-block highlight colours sit on the sunken surface,
  // callouts put body text on the soft tones, table headers on bg-subtle.
  ['color-text-muted', 'color-surface-sunken', 'AA'],
  ['color-accent', 'color-surface-sunken', 'AA'],
  ['color-success', 'color-surface-sunken', 'AA'],
  ['color-warning', 'color-surface-sunken', 'AA'],
  ['color-danger', 'color-surface-sunken', 'AA'],
  ['color-text', 'color-accent-soft', 'AA'],
  ['color-text', 'color-success-soft', 'AA'],
  ['color-text', 'color-warning-soft', 'AA'],
  ['color-text', 'color-danger-soft', 'AA'],
  ['color-accent-strong', 'color-bg-subtle', 'AA'],
  // Search (stage 3a): the top-bar field's placeholder and shortcut hint sit
  // on bg-subtle; a <mark> hit in a snippet is body text on warning-soft.
  ['color-text-muted', 'color-bg-subtle', 'AA'],
];

const THRESHOLDS = { AA: 4.5, 'AA-large': 3 };

function parseThemeBlock(css, selectorRe) {
  const m = css.match(selectorRe);
  if (!m) return {};
  const body = m[1];
  const vars = {};
  for (const decl of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[decl[1]] = decl[2].trim();
  }
  return vars;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Parses any opaque colour value this token file might use for a solid
// text/background pair. Returns [r, g, b] or null if the value isn't a
// colour we can resolve to an opaque RGB triple (e.g. a translucent
// rgba()/hsla() overlay, which isn't a valid text/background colour anyway).
function parseColor(value) {
  const hex = value.match(/^#[0-9a-f]{3,6}$/i);
  if (hex) return hexToRgb(value);

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i
  );
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4]);
    if (alpha < 1) return null; // translucent — not a solid colour to compare
    return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
  }

  return null;
}

function relativeLuminance([r, g, b]) {
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [chan(r), chan(g), chan(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

const css = readFileSync(TOKENS_PATH, 'utf8');
const light = parseThemeBlock(css, /:root\s*\{([^}]*)\}/s);
const dark = parseThemeBlock(css, /\[data-theme=['"]dark['"]\]\s*\{([^}]*)\}/s);

const themes = [
  ['light', light],
  ['dark', dark],
];

let failures = 0;
let checked = 0;

for (const [themeName, vars] of themes) {
  for (const [fgName, bgName, level] of PAIRS) {
    const fg = vars[fgName];
    const bg = vars[bgName];
    if (!fg || !bg) {
      console.error(`check-contrast: ${themeName} theme is missing --${fgName} or --${bgName}`);
      failures++;
      continue;
    }
    const fgRgb = parseColor(fg);
    const bgRgb = parseColor(bg);
    if (!fgRgb || !bgRgb) {
      console.error(
        `check-contrast: ${themeName} theme — --${fgName} (${fg}) or --${bgName} (${bg}) ` +
          `is not a solid colour this checker can resolve; fix the token or the pair list.`
      );
      failures++;
      continue;
    }
    checked++;
    const ratio = contrastRatio(fgRgb, bgRgb);
    const min = THRESHOLDS[level];
    const ok = ratio >= min;
    if (!ok) {
      failures++;
      console.error(
        `FAIL  ${themeName}  --${fgName} on --${bgName}: ${ratio.toFixed(2)}:1 ` +
          `(needs ${min}:1 for ${level})`
      );
    }
  }
}

if (failures) {
  console.error(`\ncheck-contrast: ${failures} pair(s) failed out of ${checked} checked.`);
  process.exit(1);
}
console.log(`check-contrast: ok — ${checked} text/background pairs pass WCAG AA in both themes.`);
