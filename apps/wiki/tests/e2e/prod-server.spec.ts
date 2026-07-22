import { test, expect } from '@playwright/test';
import { PROD_URL } from '../../playwright.config';

/**
 * Exercises the BUILT production server (the published `diffwiki-app` bin), not
 * the vite dev server. Catches bin-only regressions the dev suite can't see:
 *   - the bin must serve dist/client/ static assets (else the app can't hydrate)
 *   - server routes must not 500 (e.g. a bundled js-yaml 4 breaking frontmatter)
 */
test.describe('production server (bin)', () => {
  test('serves routes without 500 and SSR-renders highlighted code', async ({ request }) => {
    for (const path of ['/', '/notes', '/notes/intro']) {
      const res = await request.get(PROD_URL + path);
      expect(res.status(), `${path} status`).toBe(200);
    }
    // Article body is server-rendered and Shiki-highlighted (eval-free).
    const html = await (await request.get(PROD_URL + '/notes/intro')).text();
    expect(html, 'article HTML contains Shiki-highlighted code').toContain('class="shiki');
  });

  test('serves the built client assets', async ({ request }) => {
    const home = await (await request.get(PROD_URL + '/')).text();
    const asset = home.match(/\/assets\/[^"]+\.js/)?.[0];
    expect(asset, 'home references a built client JS asset').toBeTruthy();
    expect((await request.get(PROD_URL + asset!)).status(), 'client asset served').toBe(200);
    expect((await request.get(PROD_URL + '/favicon.svg')).status(), 'favicon served').toBe(200);
  });

  test('hydrates: article renders code + copy button with no failed asset requests', async ({ page }) => {
    const host = new URL(PROD_URL).host;
    const failed: string[] = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.host === host && r.status() >= 400) failed.push(`${r.status()} ${u.pathname}`);
    });

    await page.goto(PROD_URL + '/notes/intro', { waitUntil: 'load' });
    await expect(page.locator('pre.shiki').first()).toBeVisible();
    // The copy button is injected on the client — its presence proves hydration ran.
    await expect(page.locator('.code-copy').first()).toBeVisible();
    expect(failed, 'no 4xx/5xx from the production server').toEqual([]);
  });
});
