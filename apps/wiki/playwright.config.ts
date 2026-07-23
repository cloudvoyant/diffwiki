// apps/wiki/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The e2e servers bind DEDICATED ports (not the `pnpm dev` default of 3000, nor
 * the CLI default of 4321) so a run never reuses — or collides with — a
 * developer's own dev/prod server. With `reuseExistingServer` on, sharing 3000
 * meant local e2e silently ran against the real `~/.diffwiki` instead of the
 * fixture home; private ports keep the run hermetic on the fixtures.
 */
const E2E_DEV_PORT = 3100;
const E2E_PROD_PORT = 4400;
const E2E_STATIC_PORT = 5055;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${E2E_DEV_PORT}`;

/** The built production server (the `diffwiki-app` bin) — exercised by prod-server.spec.ts. */
export const PROD_URL = `http://127.0.0.1:${E2E_PROD_PORT}`;

/**
 * The exported static bundle, built + served by the webServer below and exercised
 * by static-export.spec.ts. Set here (not left to the caller) so the flagship
 * static-search / hydration / sub-path browser checks ALWAYS run — including in
 * CI via `mise run test` — instead of skipping on an unset STATIC_URL.
 */
export const STATIC_URL = process.env.STATIC_URL ?? `http://127.0.0.1:${E2E_STATIC_PORT}`;

/** Fixed temp home created by globalSetup before the webServer boots. */
const E2E_DIFFWIKI_HOME = '/tmp/diffwiki-e2e-home';

export default defineConfig({
  testDir: './tests/e2e',
  // Vitest-only tests live alongside the Playwright specs — exclude them.
  testIgnore: ['**/*.e2e.test.ts'],
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
          command: `node bin/wiki-server.mjs --port ${E2E_PROD_PORT}`,
          url: PROD_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { DIFFWIKI_HOME: E2E_DIFFWIKI_HOME, HOST: '127.0.0.1' },
        },
        // The exported static bundle: build it from the fixture home, then serve
        // the on-disk output. static-export.spec.ts loads this in a real browser
        // to verify hydration, client-side search, and result navigation against
        // the actual deploy artifact — the flagship behaviors this PR ships.
        {
          command: `pnpm serve:static-e2e`,
          url: STATIC_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
          env: { DIFFWIKI_HOME: E2E_DIFFWIKI_HOME },
        },
      ],
});
