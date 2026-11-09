import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants as zlib } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

// After the build, write a .br and a .gz copy next to each text file in
// dist/assets. The server sends the smallest one the browser accepts
// (@fastify/static preCompressed), so nothing is compressed per request.
function precompressAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stillwater-precompress',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    async closeBundle() {
      const dir = join(outDir, 'assets');
      const names = (await readdir(dir)).filter((n) => /\.(js|css|svg|json|txt|html|map)$/.test(n));
      await Promise.all(
        names.map(async (name) => {
          const src = await readFile(join(dir, name));
          if (src.length < 1024) return; // not worth it for tiny files
          const [br, gzipped] = await Promise.all([
            brotli(src, {
              params: {
                [zlib.BROTLI_PARAM_QUALITY]: 11,
                [zlib.BROTLI_PARAM_SIZE_HINT]: src.length,
              },
            }),
            gz(src, { level: 9 }),
          ]);
          await Promise.all([
            writeFile(join(dir, `${name}.br`), br),
            writeFile(join(dir, `${name}.gz`), gzipped),
          ]);
        }),
      );
    },
  };
}

// In development the API runs on :3000 (npm run dev --workspace apps/server);
// Vite proxies /api there so the browser sees one origin, as in production.
export default defineConfig({
  plugins: [react(), precompressAssets()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false },
      '/health': { target: process.env.API_URL ?? 'http://localhost:3000' },
    },
  },
  // No gzip size report: it compresses every chunk again just to print sizes,
  // which costs seconds on a busy box at every build (test:e2e builds first).
  build: { outDir: 'dist', sourcemap: false, reportCompressedSize: false },
});
