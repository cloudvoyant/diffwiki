// apps/wiki/tests/e2e/global-setup.ts
import fs from 'node:fs';
// @ts-expect-error — plain-JS ESM sibling; shared with the static-export webServer.
import { seedFixtureHome } from './seed-fixture.mjs';

/**
 * Fixed temp home for e2e tests. Using a fixed path (not os.tmpdir()+random) lets
 * the Playwright config's webServer.env reference the same directory deterministically
 * without coordination between global-setup and the config module.
 */
export const E2E_DIFFWIKI_HOME = '/tmp/diffwiki-e2e-home';

export default async function globalSetup(): Promise<void> {
  // Clean slate on every run, then seed via the shared module. The static-export
  // webServer seeds itself too (it boots before globalSetup runs), so this is only
  // the coordinator for the dev/prod webServers and the browser specs.
  if (fs.existsSync(E2E_DIFFWIKI_HOME)) {
    fs.rmSync(E2E_DIFFWIKI_HOME, { recursive: true, force: true });
  }

  seedFixtureHome(E2E_DIFFWIKI_HOME);
}
