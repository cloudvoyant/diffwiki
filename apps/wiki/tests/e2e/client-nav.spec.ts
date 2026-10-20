// apps/wiki/tests/e2e/client-nav.spec.ts
import { test, expect } from '@playwright/test';

test.describe('client-side navigation (same-route, different-params)', () => {
  test('mermaid diagram and copy buttons re-render after navigating away and back', async ({ page }) => {
    // Full load: the diagram renders as an SVG inside the article.
    await page.goto('/notes/intro');
    await expect(page.locator('article svg').first()).toBeVisible({ timeout: 10_000 });

    // The in-content link is routed through the router (client-side navigation).
    await page
      .locator('article')
      .getByRole('link', { name: /setting up/i })
      .click();
    await expect(page).toHaveURL(/\/notes\/guide\/setup/);
    await expect(page.getByRole('heading', { level: 1, name: /setting up/i }).first()).toBeVisible();

    // Sidebar link back to the article that holds the diagram (client-side).
    // All collection folders start collapsed, even on an article route.
    const menu = page.locator('[data-slot="sidebar-menu"]');
    await expect(menu.getByRole('link', { name: /introduction to diffwiki/i })).not.toBeVisible();
    const expandCollection = menu.getByRole('button', { name: 'Expand', exact: true }).first();
    await expect(expandCollection).toHaveAttribute('aria-expanded', 'false');
    await expandCollection.click();
    // Opening the collection does not automatically open its nested folders.
    await expect(menu.getByRole('button', { name: 'Expand', exact: true }).first()).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Scope to the sidebar nav menu — `[data-slot="sidebar"]` matches several
    // shadcn sidebar elements; the menu `<ul>` is a single stable region.
    await page
      .locator('[data-slot="sidebar-menu"]')
      .getByRole('link', { name: /introduction to diffwiki/i })
      .click();
    await expect(page).toHaveURL(/\/notes\/intro/);
    await expect(page.getByRole('heading', { level: 1, name: /introduction to diffwiki/i }).first()).toBeVisible();

    // The article subtree was remounted, so the mount effect re-ran against the
    // final committed DOM: the diagram renders again after the round-trip.
    await expect(page.locator('article svg').first()).toBeVisible({ timeout: 10_000 });
    // And the code block regains its copy button.
    await expect(page.locator('article').locator('[aria-label="Copy code"]').first()).toBeVisible();
  });
});
