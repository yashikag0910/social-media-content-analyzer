import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built site works from a domain root or from a
  // project subpath such as GitHub Pages without a rebuild.
  base: './',
  build: {
    target: 'es2022',
    // pdf.js is large by nature; the warning is noise here.
    chunkSizeWarningLimit: 1200,
  },
});
