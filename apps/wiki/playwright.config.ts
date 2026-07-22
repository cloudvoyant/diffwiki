// apps/wiki/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

/** The built production server (the `diffwiki-app` bin) — exercised by prod-server.spec.ts. */
export const PROD_URL = 'http://127.0.0.1:4321';

/** Fixed temp home created by globalSetup before the webServer boots. */
const E2E_DIFFWIKI_HOME = '/tmp/diffwiki-e2e-home';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm dev',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { DIFFWIKI_HOME: E2E_DIFFWIKI_HOME },
        },
        // The built production server (the published bin). `test:e2e` depends on
        // build, so dist/ exists. This lets prod-server.spec.ts catch bin-only
        // regressions (static assets, SSR 500s) that the dev server hides.
        {
          command: 'node bin/wiki-server.mjs --port 4321',
          url: PROD_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { DIFFWIKI_HOME: E2E_DIFFWIKI_HOME, HOST: '127.0.0.1' },
        },
      ],
});
