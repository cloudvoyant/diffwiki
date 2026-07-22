// apps/wiki/tests/e2e/home.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Home route (/)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the diffwiki logo or wordmark', async ({ page }) => {
    // The TopNav renders a link with the text "diffwiki" pointing to "/".
    // The home route also renders a larger logo/wordmark above the search bar.
    // Accept either — at least one must be present.
    const logoLink = page.getByRole('link', { name: /diffwiki/i }).first();
    await expect(logoLink).toBeVisible();
  });

  test('renders a search input', async ({ page }) => {
    const searchInput = page.getByRole('searchbox').or(page.getByPlaceholder(/search/i));
    await expect(searchInput.first()).toBeVisible();
  });

  test('renders at least one collection pill', async ({ page }) => {
    // Collection pills are rendered as links below the search bar.
    // The fixture seeds a "notes" collection so we can assert its label.
    const pill = page.getByRole('link', { name: /notes/i }).first();
    await expect(pill).toBeVisible();
  });
});
