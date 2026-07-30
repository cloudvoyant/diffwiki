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
  test('reflects the query term from the URL in the results meta', async ({ page }) => {
    await page.goto('/search?q=intro');
    // The active query is echoed in the results meta line.
    await expect(page.getByTestId('search-meta')).toContainText('intro');
  });

  test('renders an auto-focused query input on the page', async ({ page }) => {
    await page.goto('/search');
    // The search page owns its query bar; the input auto-focuses on mount.
    const input = page.getByRole('searchbox').first();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
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

  test('a collection filter restricts results to that collection', async ({ page }) => {
    // "diffwiki" appears in both the `notes` and `devlog` fixture collections, so
    // an unfiltered search returns hits from both. The `c=` filter param (set by
    // the collection dropdown) must drop every other collection's hit — the
    // regression that leaked cross-collection results.
    const results = page.getByTestId('search-results');

    // Baseline: unfiltered search surfaces BOTH collections.
    await page.goto('/search?q=diffwiki');
    await expect(results).toBeVisible();
    await expect(results.locator('li[data-collection="notes"]').first()).toBeVisible();
    await expect(results.locator('li[data-collection="devlog"]').first()).toBeVisible();

    // Filtered by `notes` (what the dropdown navigates to): only notes survives.
    await page.goto('/search?q=diffwiki&c=notes');
    await expect(results).toBeVisible();
    await expect(results.locator('li[data-collection="notes"]').first()).toBeVisible();
    await expect(results.locator('li[data-collection="devlog"]')).toHaveCount(0);

    // And filtering by `devlog` excludes notes — proving the filter is real, not
    // an artifact of notes happening to rank first.
    await page.goto('/search?q=diffwiki&c=devlog');
    await expect(results).toBeVisible();
    await expect(results.locator('li[data-collection="devlog"]').first()).toBeVisible();
    await expect(results.locator('li[data-collection="notes"]')).toHaveCount(0);
  });

  test('shows a hint when the query is empty', async ({ page }) => {
    await page.goto('/search');
    await expect(page.getByText(/search from the bar above/i)).toBeVisible();
  });

  test('navigates from the home search box to /search with the query in the URL', async ({ page }) => {
    await page.goto('/');
    // The home hero search input (the sidebar search is a button, not an input).
    const searchInput = page.getByRole('searchbox').first();
    await expect(searchInput).toBeVisible();
    // The SearchBox form has action="/search" method="get" for progressive
    // enhancement, so native form submit works even before React hydration.
    await searchInput.fill('diffwiki');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/\/search\?.*q=diffwiki/);
    // The search page echoes the active query in its results meta.
    await expect(page.getByTestId('search-meta')).toContainText('diffwiki');
  });

  test('⌘K on /search keeps the active query instead of wiping it', async ({ page }) => {
    // Regression: the global ⌘K used to always navigate to /search with an empty
    // q, clearing an in-progress query when the user was already on /search. It
    // must now no-op (focus the on-page input) and preserve q in the URL.
    await page.goto('/search?q=intro');
    await expect(page.getByTestId('search-meta')).toContainText('intro');

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+k`);

    // Query is preserved (not reset to empty) and the on-page input holds focus.
    await expect(page).toHaveURL(/\/search\?.*q=intro/);
    await expect(page.getByRole('searchbox').first()).toBeFocused();
  });
});
