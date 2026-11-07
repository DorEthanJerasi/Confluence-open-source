#!/usr/bin/env node
// `npm run check`: every typecheck, unit and API test, the originality scan and
// the contrast check, doing each piece of work once.
//
// 1. Builds `packages/shared` and `packages/editor-schema` only when their
//    sources changed (scripts/build-if-needed.mjs). The server and web
//    typechecks and the server tests read those builds.
// 2. Runs the rest side by side, each step's output kept together:
//    - one typecheck per package. The server is checked once with its test
//      config, which covers `src` and `test`. tsc keeps an incremental cache
//      in node_modules/.cache/stillwater-check, so unchanged code is not
//      re-checked on the next run.
//    - Vitest for packages/editor-schema and apps/server.
//    - the originality scan and the contrast check.
// Exits non-zero if any step fails.
//
// CHECK_JOBS=n caps how many steps run at once (default 3; 1 = one by one).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name);
const cache = join(root, 'node_modules', '.cache', 'stillwater-check');
mkdirSync(cache, { recursive: true });

const started = Date.now();
const secs = (from) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

const pre = spawnSync(
  process.execPath,
  [join(root, 'scripts/build-if-needed.mjs'), 'packages/shared', 'packages/editor-schema'],
  { cwd: root, stdio: 'inherit' },
);
if (pre.status !== 0) {
  console.error('check: FAILED building packages/shared and packages/editor-schema');
  process.exit(pre.status ?? 1);
}

const tsc = (name, project) => ({
  name,
  cmd: bin('tsc'),
  args: ['-p', project, '--noEmit', '--incremental', '--tsBuildInfoFile', join(cache, `${name.replace(/\W+/g, '-')}.tsbuildinfo`)],
  cwd: root,
});

// Longest first, so the slow ones are not left to run alone at the end.
const steps = [
  { name: 'test apps/server', cmd: bin('vitest'), args: ['run'], cwd: join(root, 'apps/server') },
  tsc('typecheck apps/server', 'apps/server/tsconfig.test.json'),
  tsc('typecheck apps/web', 'apps/web/tsconfig.json'),
  tsc('typecheck packages/editor-schema', 'packages/editor-schema/tsconfig.test.json'),
  { name: 'test packages/editor-schema', cmd: bin('vitest'), args: ['run', '--dir', 'test'], cwd: join(root, 'packages/editor-schema') },
  { name: 'originality scan', cmd: process.execPath, args: ['scripts/check-original.mjs'], cwd: root },
  { name: 'contrast check', cmd: process.execPath, args: ['scripts/check-contrast.mjs'], cwd: root },
];

function run(step) {
  return new Promise((resolve) => {
    const from = Date.now();
    const out = [];
    const child = spawn(step.cmd, step.args, {
      cwd: step.cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => out.push(d));
    child.on('error', (err) => out.push(Buffer.from(String(err))));
    child.on('close', (code) => {
      const ok = code === 0;
      process.stdout.write(`\n── ${step.name} ${ok ? 'ok' : 'FAILED'} (${secs(from)}) ──\n`);
      process.stdout.write(Buffer.concat(out).toString());
      resolve({ ...step, ok });
    });
  });
}

const jobs = Math.max(1, Number(process.env.CHECK_JOBS) || 3);
const queue = [...steps];
const results = [];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift()));
  }),
);

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length) {
  console.error(`check: FAILED ${failed.map((r) => r.name).join(', ')} (${secs(started)})`);
  process.exit(1);
}
console.log(`check: all ${results.length} steps ok (${secs(started)})`);
