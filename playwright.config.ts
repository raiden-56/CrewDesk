import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running stack (API on 4120, worker, web on 5190) with the demo
 * seed loaded and AI_PROVIDER=mock. Start everything with `pnpm dev`, then `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5190',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/owner.json' }, dependencies: ['setup'], testIgnore: /auth\.setup\.ts/ },
  ],
});
