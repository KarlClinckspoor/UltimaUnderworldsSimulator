import { defineConfig } from 'vite';

// Static site: `npm run build` writes dist/, which works from any static host
// (relative base so it also opens from a sub-folder such as GitHub Pages).
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
