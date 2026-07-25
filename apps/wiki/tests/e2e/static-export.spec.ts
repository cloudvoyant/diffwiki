/**
 * Playwright spec for the static export — exercises the REAL served bundle.
 *
 * The playwright.config webServer builds + exports the static site from the e2e
 * fixture home and serves it on STATIC_URL, so these browser checks run
 * unconditionally in `mise run test:e2e` (and, via `mise run test`, in CI). They
 * verify the two flagship behaviors the export ships: client-side search on the
 * frozen bundle, and hydrated navigation between prerendered routes — the deploy
 * artifact a GitHub Pages host would serve.
 *
 * To point at an already-running bundle instead, set STATIC_URL:
 *   mise run export ./dist-site /
 *   node apps/wiki/bin/serve-static.mjs ./dist-site --port 5055 &
 *   STATIC_URL=http://127.0.0.1:5055 pnpm --filter diffwiki-app test:e2e
 */
import { test, expect, request } from '@playwright/test';
import { STATIC_URL } from '../../playwright.config';

test.describe('static export — HTTP smoke (search-index + nav-tree)', () => {
  test('search-index.json is reachable and is a non-empty array with tags', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const idx = await ctx.get('/search-index.json');
    expect(idx.status(), 'search-index.json must be 200').toBe(200);
    const data = (await idx.json()) as { slug: string; title: string; tags: string[] }[];
    expect(Array.isArray(data), 'search-index.json must be an array').toBe(true);
    expect(data.length, 'search-index.json must be non-empty').toBeGreaterThan(0);
    const intro = data.find((d) => d.slug === 'intro');
    expect(intro, 'intro doc must be indexed').toBeDefined();
    // Tags must survive the export (regression guard for the tags:[] bug).
    expect(intro!.tags).toContain('overview');
    await ctx.dispose();
  });

  test('_data/nav-tree.json is reachable and has collections', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const nav = await ctx.get('/_data/nav-tree.json');
    expect(nav.status(), '_data/nav-tree.json must be 200').toBe(200);
    const data = (await nav.json()) as { collection: { name: string } }[];
    expect(Array.isArray(data), '_data/nav-tree.json must be an array').toBe(true);
    expect(data.some((c) => c.collection.name === 'notes')).toBe(true);
    await ctx.dispose();
  });

  test('per-doc JSON for a nested article is reachable', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const doc = await ctx.get('/_data/doc/notes/guide/setup.json');
    expect(doc.status(), 'nested per-doc JSON must be 200').toBe(200);
    const data = (await doc.json()) as { title: string };
    expect(data.title).toBe('Setting Up');
    await ctx.dispose();
  });

  test('_data/graph.json is reachable with nodes + the intro→setup edge', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const res = await ctx.get('/_data/graph.json');
    expect(res.status(), '_data/graph.json must be 200').toBe(200);
    const g = (await res.json()) as { nodes: { id: string }[]; edges: { source: string; target: string }[] };
    expect(g.nodes.some((n) => n.id === 'notes/intro')).toBe(true);
    expect(g.edges.some((e) => e.source === 'notes/intro' && e.target === 'notes/guide/setup')).toBe(true);
    await ctx.dispose();
  });

  test('per-doc graph preview only references pages that were emitted (no dangling links)', async () => {
    // Static/dynamic parity guard: every node id in a page's sidebar graph must have
    // a corresponding emitted per-doc JSON, so clicking a preview node never 404s.
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const doc = await ctx.get('/_data/doc/notes/intro.json');
    expect(doc.status()).toBe(200);
    const data = (await doc.json()) as { graph?: { nodes: { id: string; kind: string }[] } };
    expect(data.graph, 'intro doc must carry a sidebar graph').toBeDefined();
    for (const node of data.graph!.nodes) {
      if (node.kind === 'tag') continue; // tag hubs are not pages — they never navigate/404
      const emitted = await ctx.get(`/_data/doc/${node.id}.json`);
      expect(emitted.status(), `preview node ${node.id} must have an emitted page`).toBe(200);
    }
    await ctx.dispose();
  });
});

test.describe('static export — browser hydration and search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(STATIC_URL, { waitUntil: 'load' });
  });

  test('home page renders the diffwiki wordmark', async ({ page }) => {
    const logo = page.getByRole('link', { name: /diffwiki/i }).first();
    await expect(logo).toBeVisible();
  });

  test('the nav tree hydrates with the seeded collection', async ({ page }) => {
    // The sidebar is rendered from _data/nav-tree.json after hydration; if the
    // client bundle did not hydrate, this link never appears.
    await expect(page.getByRole('link', { name: /notes/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('search box is enabled and interactive', async ({ page }) => {
    const box = page.getByRole('searchbox').first();
    await expect(box).toBeEnabled();
  });

  test('submitting a query runs client-side search and shows a matching result', async ({ page }) => {
    // Type + Enter → /search?q=… → the client scores the prebuilt index (no
    // server) and renders results. This is the flagship static-search flow.
    const box = page.getByRole('searchbox').first();
    await box.fill('introduction');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=introduction/);
    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible({ timeout: 10_000 });
    await expect(results.getByRole('link', { name: /introduction/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a search result navigates to the article and it hydrates', async ({ page }) => {
    const box = page.getByRole('searchbox').first();
    await box.fill('introduction');
    await box.press('Enter');
    const firstResult = page
      .getByTestId('search-results')
      .getByRole('link', { name: /introduction/i })
      .first();
    await expect(firstResult).toBeVisible({ timeout: 10_000 });
    await firstResult.click();
    await expect(page).toHaveURL(/notes\/intro/);
    // The article body must render after client-side navigation.
    await expect(page.getByRole('heading', { name: /introduction/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('article page has Shiki-highlighted code', async ({ page }) => {
    await page.goto(`${STATIC_URL}/notes/intro`, { waitUntil: 'load' });
    const shiki = page.locator('.shiki').first();
    await expect(shiki).toBeVisible({ timeout: 10_000 });
  });

  test('tag matching: searching a frontmatter tag returns the tagged article', async ({ page }) => {
    // "overview" is a tag on intro.md, not body text — this exercises tag-aware
    // scoring in the client BM25 index built from search-index.json.
    const box = page.getByRole('searchbox').first();
    await box.fill('overview');
    await box.press('Enter');
    const results = page.getByTestId('search-results');
    await expect(results).toBeVisible({ timeout: 10_000 });
    await expect(results.getByRole('link', { name: /introduction/i }).first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('static export — draft/private articles are skipped', () => {
  /** Recursively collect every node path in a nav-tree.json payload. */
  function allPaths(nodes: { path?: string; children?: unknown[] }[]): string[] {
    const out: string[] = [];
    for (const n of nodes) {
      if (n.path) out.push(n.path);
      if (Array.isArray(n.children)) out.push(...allPaths(n.children as typeof nodes));
    }
    return out;
  }

  test('draft/private articles are absent from the search index', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const idx = (await (await ctx.get('/search-index.json')).json()) as { slug: string }[];
    const slugs = idx.map((d) => d.slug);
    expect(slugs).not.toContain('scratchpad');
    expect(slugs).not.toContain('confidential');
    // Positive control: a public sibling in the same collection IS indexed.
    expect(slugs).toContain('intro');
    await ctx.dispose();
  });

  test('draft/private articles are absent from the nav tree', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    const nav = (await (await ctx.get('/_data/nav-tree.json')).json()) as {
      collection: { name: string };
      nodes: { path?: string; children?: unknown[] }[];
    }[];
    const notes = nav.find((c) => c.collection.name === 'notes');
    expect(notes).toBeDefined();
    const paths = allPaths(notes!.nodes);
    expect(paths).not.toContain('/notes/scratchpad');
    expect(paths).not.toContain('/notes/confidential');
    // Positive control: the public nested article IS present.
    expect(paths).toContain('/notes/guide/setup');
    await ctx.dispose();
  });

  test('draft/private per-doc JSON is not emitted (404)', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    expect((await ctx.get('/_data/doc/notes/scratchpad.json')).status()).toBe(404);
    expect((await ctx.get('/_data/doc/notes/confidential.json')).status()).toBe(404);
    await ctx.dispose();
  });

  test('a private folder skips its whole subtree — even public children', async () => {
    const ctx = await request.newContext({ baseURL: STATIC_URL });
    // Nav: neither the private folder nor its public child appear.
    const nav = (await (await ctx.get('/_data/nav-tree.json')).json()) as {
      collection: { name: string };
      nodes: { path?: string; children?: unknown[] }[];
    }[];
    const notes = nav.find((c) => c.collection.name === 'notes');
    const paths = allPaths(notes!.nodes);
    expect(paths).not.toContain('/notes/archive');
    expect(paths).not.toContain('/notes/archive/old-note');
    // Search index: the public child of a private folder is not indexed.
    const idx = (await (await ctx.get('/search-index.json')).json()) as { slug: string }[];
    expect(idx.map((d) => d.slug)).not.toContain('archive/old-note');
    // Routes: the child's per-doc JSON is not emitted.
    expect((await ctx.get('/_data/doc/notes/archive/old-note.json')).status()).toBe(404);
    await ctx.dispose();
  });
});
