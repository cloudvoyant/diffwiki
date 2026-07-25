import { test, expect } from '@playwright/test';

test.describe('Knowledge graph', () => {
  test.beforeEach(async ({ page }) => {
    // The right-hand aside (graph + TOC) only renders at the desktop breakpoint
    // (>= 84rem ≈ 1344px), so use a wide viewport.
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto('/notes/intro');
  });

  test('renders the graph panel above the TOC', async ({ page }) => {
    // The preview renders an SVG with role="img"; the expand affordance sits on it.
    const preview = page.getByRole('img', { name: /knowledge graph/i }).first();
    await expect(preview).toBeVisible();
    await expect(page.getByRole('button', { name: /expand knowledge graph/i })).toBeAttached();
  });

  test('expands to the full-screen overlay on click', async ({ page }) => {
    const expandButton = page.getByRole('button', { name: /expand knowledge graph/i });
    const dialog = page.getByRole('dialog');
    // The panel is server-rendered, so the expand button exists before React
    // hydrates; a click that lands pre-hydration is dropped. Retry the click until
    // the (hydrated) handler opens the dialog, so the test is not hydration-timing
    // flaky.
    await expect(async () => {
      await expandButton.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    // The overlay renders the full graph and floating mode controls.
    await expect(dialog.getByRole('img', { name: /knowledge graph/i })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Tags' })).toBeVisible();
    // Close it again.
    await page.getByRole('button', { name: /close graph/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('clicking a neighbour node in the overlay navigates to that page', async ({ page }) => {
    // intro.md links to /notes/guide/setup, so the overlay graph has a `Setting Up`
    // node adjacent to the focused intro node. Clicking it must navigate there —
    // the headline click-to-navigate behaviour.
    const expandButton = page.getByRole('button', { name: /expand knowledge graph/i });
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      await expandButton.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    // The overlay force-graph renders labelled nodes as <circle><title>…</title>.
    // d3-force lays them out client-side, so wait for the Setting Up node to appear.
    const setupNode = dialog.locator('circle', { has: page.locator('title', { hasText: 'Setting Up' }) }).first();
    await expect(setupNode).toBeVisible({ timeout: 10_000 });
    await setupNode.click();
    // The headline behaviour: the click navigates the router to the neighbour page.
    await expect(page).toHaveURL(/notes\/guide\/setup/);
    // The overlay is a modal Radix dialog (it aria-hides the page behind it), so close
    // it, then assert the destination article actually rendered after navigation.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /setting up/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('a folder index page shows its links, not an empty graph', async ({ page }) => {
    // /notes/guide is served from guide/index.md, which links to ./setup. The graph
    // preview must show that link — a folder index used to render "No links…".
    await page.goto('/notes/guide');
    const preview = page.getByRole('img', { name: /knowledge graph/i }).first();
    await expect(preview).toBeVisible();
    await expect(page.getByText(/no links on this page/i)).toHaveCount(0);
    // Open the overlay and confirm the Setting Up neighbour is present.
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      await page.getByRole('button', { name: /expand knowledge graph/i }).click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    const setupNode = dialog.locator('circle', { has: page.locator('title', { hasText: 'Setting Up' }) }).first();
    await expect(setupNode).toBeVisible({ timeout: 10_000 });
  });
});
