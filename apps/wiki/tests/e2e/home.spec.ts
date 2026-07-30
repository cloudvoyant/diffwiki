// apps/wiki/tests/e2e/home.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Home route (/)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the diffwiki logo or wordmark', async ({ page }) => {
    // Both the sidebar branding and the home hero render a "diffwiki" link to "/".
    // Accept either — at least one must be present.
    const logoLink = page.getByRole('link', { name: /diffwiki/i }).first();
    await expect(logoLink).toBeVisible();
  });

  test('renders a search input in the home hero', async ({ page }) => {
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
    await expect(searchInput.first()).toBeVisible();
  });

  test('the sidebar exposes a Search button (not an input)', async ({ page }) => {
    // The sidebar search is a button that navigates to /search — not a text field.
    // Unlike the home hero SearchBox (a native form with action="/search"), the
    // button navigates via the router, so it only works once React has hydrated
    // the onClick handler. Retry the click until navigation takes effect.
    const searchButton = page.getByRole('button', { name: /^search$/i });
    await expect(searchButton).toBeVisible();
    await expect(async () => {
      await searchButton.click();
      await expect(page).toHaveURL(/\/search/, { timeout: 1000 });
    }).toPass();
  });

  test('renders at least one collection pill', async ({ page }) => {
    // Collection pills are rendered as links below the search bar.
    // The fixture seeds a "notes" collection so we can assert its label.
    const pill = page.getByRole('link', { name: /notes/i }).first();
    await expect(pill).toBeVisible();
  });
});
