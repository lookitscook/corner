import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages builds use /corner/; local development uses the site root.
  base: process.env.VITE_BASE_PATH || '/',
});
