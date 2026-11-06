#!/usr/bin/env node
// Runs a workspace build only when its output is missing or older than its
// sources, so the test commands don't spend minutes rebuilding unchanged code.
// Usage: node scripts/build-if-needed.mjs <workspace> [<workspace> ...]
// Set FORCE_BUILD=1 to always build.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// What each workspace builds from and what it writes.
const outputs = {
  'packages/shared': 'dist/index.js',
  'packages/editor-schema': 'dist/index.js',
  'apps/web': 'dist/index.html',
  'apps/server': 'dist/index.js',
};
const inputs = ['src', 'index.html', 'package.json', 'tsconfig.json', 'vite.config.ts', 'public'];

function newest(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const name of readdirSync(path)) max = Math.max(max, newest(join(path, name)));
  return max;
}

let upstreamBuilt = 0;
for (const ws of process.argv.slice(2)) {
  const dir = join(root, ws);
  const out = join(dir, outputs[ws] ?? 'dist/index.js');
  const outTime = existsSync(out) ? statSync(out).mtimeMs : 0;
  const inTime = Math.max(upstreamBuilt, ...inputs.map((p) => newest(join(dir, p))));
  if (process.env.FORCE_BUILD !== '1' && outTime > 0 && outTime >= inTime) {
    console.log(`build: ${ws} is up to date, skipped`);
    upstreamBuilt = Math.max(upstreamBuilt, outTime);
    continue;
  }
  console.log(`build: ${ws}`);
  const r = spawnSync('npm', ['run', 'build', '--workspace', ws], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  // Later workspaces depend on this one, so they must rebuild too.
  upstreamBuilt = Date.now();
}
