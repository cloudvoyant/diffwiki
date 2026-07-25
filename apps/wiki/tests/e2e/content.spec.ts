// apps/wiki/tests/e2e/content.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Content route (/$coll/*path)', () => {
  test.describe('intro.md — markdown with code block + mermaid', () => {
    test.beforeEach(async ({ page }) => {
      // The fixture article is at notes/intro.md → route /notes/intro
      await page.goto('/notes/intro');
    });

    test('renders the article title as h1', async ({ page }) => {
      // The route renders an explicit <h1> title AND the MDX body may also contain an h1;
      // use .first() to avoid strict-mode violations when both are present.
      const heading = page.getByRole('heading', { level: 1, name: /introduction to diffwiki/i }).first();
      await expect(heading).toBeVisible();
    });

    test('renders at least one tag badge', async ({ page }) => {
      // Tags are rendered as badge-styled elements. The fixture has "overview" and
      // "getting-started". Match either.
      const badge = page
        .getByText(/overview/i)
        .or(page.getByText(/getting-started/i))
        .first();
      await expect(badge).toBeVisible();
    });

    test('renders prose body content', async ({ page }) => {
      const prose = page.getByText(/your local, git-friendly knowledge base/i);
      await expect(prose).toBeVisible();
    });

    test('renders a code block with a copy button', async ({ page }) => {
      // CodeBlock renders a <button> with "Copy" or an accessible label.
      const copyBtn = page.getByRole('button', { name: /copy/i }).or(page.locator('[aria-label="Copy code"]')).first();
      await expect(copyBtn).toBeVisible();
    });

    test('renders the mermaid diagram as an SVG', async ({ page }) => {
      // Mermaid renders the chart inside a container; wait up to 10s for the SVG.
      const mermaidSvg = page.locator('svg').first();
      await expect(mermaidSvg).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('guide/setup.mdx — nested file', () => {
    test.beforeEach(async ({ page }) => {
      // Nested article at notes/guide/setup.mdx → route /notes/guide/setup
      await page.goto('/notes/guide/setup');
    });

    test('renders without error (200 with h1)', async ({ page }) => {
      const heading = page.getByRole('heading', { level: 1, name: /setting up/i }).first();
      await expect(heading).toBeVisible();
    });

    test('renders the nested markdown body', async ({ page }) => {
      const body = page.getByText(/renders from plain/i);
      await expect(body).toBeVisible();
    });
  });
});

test.describe('article status badge (local serve)', () => {
  test('a draft article shows a Draft badge above the title', async ({ page }) => {
    await page.goto('/notes/scratchpad');
    await expect(page.getByRole('heading', { level: 1, name: /scratchpad wip/i }).first()).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  });

  test('a private article shows a Private badge above the title', async ({ page }) => {
    await page.goto('/notes/confidential');
    await expect(page.getByRole('heading', { level: 1, name: /confidential memo/i }).first()).toBeVisible();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
  });

  test('a public article shows a Public badge above the title', async ({ page }) => {
    await page.goto('/notes/intro');
    await expect(page.getByRole('heading', { level: 1, name: /introduction to diffwiki/i }).first()).toBeVisible();
    await expect(page.getByText('Public', { exact: true })).toBeVisible();
  });
});
