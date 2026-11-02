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
  build: { outDir: 'dist', sourcemap: false },
});
