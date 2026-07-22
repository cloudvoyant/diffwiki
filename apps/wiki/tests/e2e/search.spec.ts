// apps/wiki/tests/e2e/search.spec.ts
import { test as base, expect } from '@playwright/test';

/**
 * Every test in this file also fails on any uncaught client-side error. The old
 * suite only asserted on SSR-rendered DOM, so a client-only crash (e.g. a Node
 * built-in like `child_process` leaking into the browser bundle and throwing on
 * hydration) left the server-rendered elements visible and the tests green. This
 * auto-fixture collects `pageerror` events and asserts none occurred.
 */
const test = base.extend<{ noClientErrors: void }>({
  noClientErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await use();
      expect(errors, `uncaught client-side errors:\n${errors.join('\n')}`).toEqual([]);
    },
    { auto: true },
  ],
});

test.describe('Search route (/search)', () => {
  test('reflects the query term from the URL in the search bar', async ({ page }) => {
    await page.goto('/search?q=intro');
    // The sidebar also has a SearchBox, so target the search page's input inside
    // the SidebarInset content area (the main content inset rendered after the sidebar).
    const searchInput = page.locator('[data-slot="sidebar-inset"] input[type="search"]').first();
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveValue('intro');
  });

  test('renders the collection filter with an "All collections" option', async ({ page }) => {
    await page.goto('/search?q=intro');
    const filter = page.getByLabel(/filter by collection/i);
    await expect(filter).toBeVisible();
    await expect(filter.getByRole('option', { name: /all collections/i })).toHaveCount(1);
  });

  test('mode dropdown always contains the native · bm25 option', async ({ page }) => {
    await page.goto('/search?q=intro');
    const modeSelect = page.getByLabel(/search mode/i);
    await expect(modeSelect).toBeVisible();
    // listSearchModes() always prepends native · bm25 regardless of installed plugins.
    await expect(modeSelect.getByRole('option', { name: /native · bm25/i })).toHaveCount(1);
  });

  test('mode dropdown value matches the engine and type params when provided', async ({ page }) => {
    // Navigate directly with engine and type params set.
    await page.goto('/search?q=intro&engine=native&type=basic');
    const modeSelect = page.getByLabel(/search mode/i);
    await expect(modeSelect).toBeVisible();
    // The select should reflect the engine:type from the URL params.
    await expect(modeSelect).toHaveValue('native:basic');
  });

  test('renders either a results list or a no-results message for a non-empty query', async ({ page }) => {
    await page.goto('/search?q=intro');
    const results = page.getByTestId('search-results');
    const noResults = page.getByText(/no results for/i);
    await expect(results.or(noResults).first()).toBeVisible();
  });

  test('shows a hint when the query is empty', async ({ page }) => {
    await page.goto('/search');
    await expect(page.getByText(/type a query and press enter/i)).toBeVisible();
  });

  test('navigates from the home search box to /search with the query in the URL', async ({ page }) => {
    await page.goto('/');
    // Target the content area search box (inside SidebarInset), not the sidebar's.
    const searchInput = page.locator('[data-slot="sidebar-inset"] input[type="search"]').first();
    await expect(searchInput).toBeVisible();
    // The SearchBox form has action="/search" method="get" for progressive
    // enhancement, so native form submit works even before React hydration.
    await searchInput.fill('diffwiki');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/\/search\?.*q=diffwiki/);
    // After navigation, the search page's input should reflect the term.
    const pageSearchInput = page.locator('[data-slot="sidebar-inset"] input[type="search"]').first();
    await expect(pageSearchInput).toHaveValue('diffwiki');
  });
});
