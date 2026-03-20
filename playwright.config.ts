import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // extensions don't parallelise well
  workers: 1, // Single worker
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html'], ['list']],
  use: {
    headless: false, // extensions require headed mode
    trace: 'on-first-retry',
  },
});
