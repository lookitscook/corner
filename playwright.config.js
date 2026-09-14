import { defineConfig } from '@playwright/test';

const baseURL = `http://127.0.0.1:4173${process.env.VITE_BASE_PATH || '/'}`;

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.test.js',
  outputDir: './test-results',
  timeout: 60_000,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
});
