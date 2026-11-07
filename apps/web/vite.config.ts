import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3000 (npm run dev --workspace apps/server);
// Vite proxies /api there so the browser sees one origin, as in production.
export default defineConfig({
  plugins: [react()],
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
