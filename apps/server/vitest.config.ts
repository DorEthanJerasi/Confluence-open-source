import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    include: ['test/**/*.test.ts'],
    // All files share one database; run them one after another, in one
    // process that loads the app's modules once (no file sets globals or
    // mocks modules). Reloading them for each of the 14 files cost ~90s of
    // the ~300s run on a busy machine.
    fileParallelism: false,
    isolate: false,
    // fastify's inject() needs require(esm); default from Node 22.12, flag before that.
    poolOptions: { forks: { singleFork: true, execArgv: ['--experimental-require-module', '--no-warnings'] } },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
