// apps/wiki/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The e2e dev server binds a DEDICATED port (not the `pnpm dev` default of 3000)
 * so a run never reuses — or collides with — a developer's own dev server. With
 * `reuseExistingServer` on, sharing 3000 meant local e2e silently ran against the
 * real `~/.diffwiki` instead of the fixture home; a private port keeps the run
 * hermetic on the fixtures.
 */
const E2E_DEV_PORT = 3100;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${E2E_DEV_PORT}`;

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
          command: 'pnpm dev:e2e',
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
