import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    include: ['test/**/*.test.ts'],
    // All files share one database; run them one after another.
    fileParallelism: false,
    // fastify's inject() needs require(esm); default from Node 22.12, flag before that.
    poolOptions: { forks: { execArgv: ['--experimental-require-module', '--no-warnings'] } },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
