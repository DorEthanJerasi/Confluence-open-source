#!/usr/bin/env node
// Originality check for Stillwater.
//
// Fails (exit 1) if any file in the repo uses another company's product or
// company names, their design-kit packages, or their signature brand colours,
// in file contents or file names. See ARCHITECTURE.md §1.
//
// Usage:  node scripts/check-original.mjs [dir]     (default: repo root)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(process.argv[2] ?? join(dirname(SELF), '..'));

// Names that must never appear (case-insensitive, also inside identifiers
// and paths such as "jiraClient" or "confluence-logo.svg").
const BANNED_NAMES = [
  'atlassian',
  'confluence',
  'jira',
  'trello',
  'bitbucket',
  'atlaskit',
];

// Brand colours of the product we are modelled on. Our palette is our own.
const BANNED_COLOURS = ['#0052cc', '#0065ff', '#2684ff', '#172b4d', '#253858', '#deebff'];

// Directories never scanned: VCS, agent config, dependencies, generated output.
const SKIP_DIRS = new Set([
  '.git',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vite',
  '.cache',
  'playwright-report',
  'test-results',
]);

// Files never scanned (relative to ROOT). PROJECT.md is the owner's brief.
const SKIP_FILES = new Set(['PROJECT.md', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

const MAX_BYTES = 2 * 1024 * 1024;

const nameInFileRe = new RegExp(`(${BANNED_NAMES.join('|')})`, 'i');
const colourRe = new RegExp(`(${BANNED_COLOURS.join('|')})(?:[0-9a-f]{2})?(?![0-9a-f])`, 'i');

const problems = [];

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanFile(abs, rel) {
  if (nameInFileRe.test(basename(rel))) {
    problems.push(`${rel}: file name uses a banned name`);
  }
  const st = statSync(abs);
  if (st.size > MAX_BYTES) return;
  const buf = readFileSync(abs);
  if (isBinary(buf)) return;
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(nameInFileRe);
    if (m) problems.push(`${rel}:${i + 1}: banned name "${m[1]}"`);
    const c = line.match(colourRe);
    if (c) problems.push(`${rel}:${i + 1}: banned brand colour ${c[1]}`);
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (nameInFileRe.test(entry.name)) problems.push(`${rel}/: folder name uses a banned name`);
      walk(abs);
    } else if (entry.isFile()) {
      if (abs === SELF || SKIP_FILES.has(rel)) continue;
      scanFile(abs, rel);
    }
  }
}

walk(ROOT);

if (problems.length) {
  console.error(`check-original: ${problems.length} problem(s) found\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nStillwater uses its own name, words, colours and assets. Remove or rename the above.');
  process.exit(1);
}
console.log('check-original: ok — no banned names, packages or brand colours found.');
