import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './corner-gradient/tests',
  testMatch: 'browser.test.js',
  outputDir: './test-results',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run build:standalone && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
