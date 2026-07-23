/**
 * Static-export harness e2e test (vitest, no browser).
 *
 * Runs the real export pipeline end-to-end against on-disk output and asserts the
 * emitted bundle. It is NOT opt-in and NOT skipped: if `dist-static/` is missing
 * it BUILDS it first (once), so this flagship-feature coverage always executes in
 * `mise run test` / CI — never silently skips. The `.e2e.test.ts` name keeps it
 * out of the fast `mise run test:unit` run (which excludes e2e test files by
 * their .e2e.test.ts suffix).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIKI_ROOT = path.resolve(__dirname, '../..');
const DIST_STATIC = path.join(WIKI_ROOT, 'dist-static');
const SERVER_ENTRY = path.join(DIST_STATIC, 'server', 'server.js');
const EXPORT_SCRIPT = path.join(WIKI_ROOT, 'bin', 'export.mjs');

/**
 * Ensure the static Vite bundle exists — build it once if missing so the export
 * harness has something to prerender. Memoised so both beforeAll hooks share one
 * build. This is what makes the test self-sufficient (no skip, runs in CI).
 */
const BASE_MARKER = path.join(DIST_STATIC, '.diffwiki-base');
let distStaticReady: Promise<void> | undefined;
function ensureDistStatic(): Promise<void> {
  distStaticReady ??= (async () => {
    const exists = await fs
      .access(SERVER_ENTRY)
      .then(() => true)
      .catch(() => false);
    // Reuse ONLY a bundle known to be base "/" (marker). A leftover bundle built
    // with a different base would make the base-"/" export prerender broken HTML
    // (assets under the wrong prefix, "fetch failed" shells), so rebuild unless
    // the marker proves it is base "/".
    const markedRoot = exists
      ? await fs
          .readFile(BASE_MARKER, 'utf8')
          .then((s) => s.trim() === '/')
          .catch(() => false)
      : false;
    if (exists && markedRoot) return;
    await execFileAsync('pnpm', ['exec', 'vite', 'build', '--outDir', 'dist-static'], {
      cwd: WIKI_ROOT,
      env: { ...process.env, VITE_DIFFWIKI_STATIC: '1', DIFFWIKI_BASE: '/' },
      timeout: 300_000,
    });
    await fs.writeFile(BASE_MARKER, '/');
  })();
  return distStaticReady;
}

/**
 * Seed a temp DIFFWIKI_HOME with a realistic collection:
 * - A root-level article with tags
 * - A nested subfolder article
 * - A subfolder with no index (tests listing generation)
 * - registry.json wired to the collection
 */
async function seedHome(homeDir: string): Promise<string> {
  const collectionsDir = path.join(homeDir, 'collections');
  const notesDir = path.join(collectionsDir, 'notes');
  const guideDir = path.join(notesDir, 'guide');
  const emptyDir = path.join(notesDir, 'empty-folder');

  await fs.mkdir(guideDir, { recursive: true });
  await fs.mkdir(emptyDir, { recursive: true });

  await fs.writeFile(
    path.join(notesDir, 'intro.md'),
    `---
title: Introduction
tags:
  - overview
  - getting-started
---

# Introduction

Welcome to **diffwiki** — your local, git-friendly knowledge base.

\`\`\`ts
const x: number = 42;
\`\`\`
`,
    'utf8',
  );

  await fs.writeFile(
    path.join(guideDir, 'setup.md'),
    `---
title: Setting Up
tags:
  - setup
---

# Setting Up

Run \`mise run dev\` to start the UI.
`,
    'utf8',
  );

  // An empty subfolder — the exporter should not emit a route for it (or emit
  // a listing with zero entries). This tests the robustness edge.
  // (emptyDir is created above but contains no .md files)

  const registry = {
    version: '1',
    collections: [{ name: 'notes', type: 'global', path: notesDir, createdAt: new Date().toISOString() }],
  };
  await fs.writeFile(path.join(homeDir, 'registry.json'), JSON.stringify(registry), 'utf8');
  await fs.writeFile(path.join(homeDir, 'config.json'), JSON.stringify({ defaultCollection: 'notes' }), 'utf8');

  return notesDir;
}

let tmpHome: string;
let outDir: string;

beforeAll(async () => {
  await ensureDistStatic();

  tmpHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-export-e2e-')));
  outDir = path.join(tmpHome, 'dist-site');

  await seedHome(tmpHome);

  // Run the export harness (same as `mise run export`).
  await execFileAsync('node', [EXPORT_SCRIPT, '--out', outDir, '--base', '/'], {
    env: {
      ...process.env,
      DIFFWIKI_HOME: tmpHome,
      DIFFWIKI_STATIC: '1',
    },
    timeout: 120_000,
  });
}, 420_000);

afterAll(async () => {
  if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true });
});

describe('static export harness — on-disk bundle', () => {
  it('emits .nojekyll', async () => {
    await expect(fs.access(path.join(outDir, '.nojekyll'))).resolves.toBeUndefined();
  });

  it('emits search-index.json with real content and tags', async () => {
    const raw = await fs.readFile(path.join(outDir, 'search-index.json'), 'utf8');
    const idx: { collection: string; slug: string; title: string; tags: string[] }[] = JSON.parse(raw);
    expect(Array.isArray(idx)).toBe(true);
    expect(idx.length).toBeGreaterThan(0);

    const intro = idx.find((d) => d.slug === 'intro');
    expect(intro).toBeDefined();
    expect(intro!.title).toBe('Introduction');
    // Tags must come from real frontmatter, not hard-coded [].
    expect(intro!.tags).toContain('overview');
    expect(intro!.tags).toContain('getting-started');

    const setup = idx.find((d) => d.slug === 'guide/setup');
    expect(setup).toBeDefined();
    expect(setup!.tags).toContain('setup');
  });

  it('emits _data/nav-tree.json', async () => {
    const raw = await fs.readFile(path.join(outDir, '_data', 'nav-tree.json'), 'utf8');
    const nav: { collection: { name: string }; nodes: unknown[] }[] = JSON.parse(raw);
    expect(Array.isArray(nav)).toBe(true);
    const notesColl = nav.find((c) => c.collection.name === 'notes');
    expect(notesColl).toBeDefined();
  });

  it('emits per-doc JSON for the flat article', async () => {
    const docFile = path.join(outDir, '_data', 'doc', 'notes', 'intro.json');
    const raw = await fs.readFile(docFile, 'utf8');
    const doc: { kind: string; title: string; html: string; tags: string[] } = JSON.parse(raw);
    expect(doc.kind).toBe('doc');
    expect(doc.title).toBe('Introduction');
    // HTML must contain Shiki-highlighted code (the `ts` fence in intro.md).
    expect(doc.html).toContain('class="shiki');
    // Tags flow through from search index (and resolvePage tags from frontmatter).
    expect(Array.isArray(doc.tags)).toBe(true);
  });

  it('emits per-doc JSON for the nested article (guide/setup)', async () => {
    const docFile = path.join(outDir, '_data', 'doc', 'notes', 'guide', 'setup.json');
    const raw = await fs.readFile(docFile, 'utf8');
    const doc: { kind: string; title: string } = JSON.parse(raw);
    expect(doc.kind).toBe('doc');
    expect(doc.title).toBe('Setting Up');
  });

  it('prerenders the home page HTML', async () => {
    const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
    // SSR'd HTML must contain <html> scaffolding.
    expect(html).toContain('<html');
    // Should reference a JS asset (hydration bundle).
    expect(html).toMatch(/\.js/);
  });

  it('prerenders collection index HTML', async () => {
    const htmlFile = path.join(outDir, 'notes', 'index.html');
    const html = await fs.readFile(htmlFile, 'utf8');
    expect(html).toContain('<html');
  });

  it('prerenders the nested article HTML', async () => {
    const htmlFile = path.join(outDir, 'notes', 'guide', 'setup', 'index.html');
    const html = await fs.readFile(htmlFile, 'utf8');
    expect(html).toContain('<html');
  });

  it('emits client assets (the Vite bundle)', async () => {
    // The Vite build emits to dist-static/client/ which export.mjs copies to outDir.
    // There must be at least one .js asset.
    const assetsDir = path.join(outDir, 'assets');
    const assets = await fs.readdir(assetsDir).catch(() => [] as string[]);
    const jsAssets = assets.filter((f) => f.endsWith('.js'));
    expect(jsAssets.length).toBeGreaterThan(0);
  });
});

// ── Base-path variant ──────────────────────────────────────────────────────────

let bpHome: string;
let bpOutDir: string;
let bpStaticDir: string;

const BASE_PATH = '/my-wiki/';

/**
 * The sub-path variant needs a dist-static built with a MATCHING base so the
 * prerendered HTML actually references assets under `/my-wiki/`. We build a
 * dedicated bundle into a temp dir and point export.mjs at it via
 * DIFFWIKI_STATIC_DIR — this avoids clobbering the shared base-"/" dist-static
 * that the on-disk-bundle suite above depends on.
 */
beforeAll(async () => {
  bpHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-export-bp-')));
  bpOutDir = path.join(bpHome, 'dist-bp');
  // The base-path bundle MUST live inside the workspace so its SSR server.js can
  // resolve node_modules (react, etc.) at prerender time — a temp-dir bundle
  // outside the package tree fails module resolution.
  bpStaticDir = path.join(WIKI_ROOT, 'dist-static-bp');

  await seedHome(bpHome);

  // Build a base-path bundle and stamp its base marker so export.mjs reuses it.
  await execFileAsync('pnpm', ['exec', 'vite', 'build', '--outDir', bpStaticDir], {
    cwd: WIKI_ROOT,
    env: { ...process.env, VITE_DIFFWIKI_STATIC: '1', DIFFWIKI_BASE: BASE_PATH },
    timeout: 300_000,
  });
  await fs.writeFile(path.join(bpStaticDir, '.diffwiki-base'), BASE_PATH);

  await execFileAsync('node', [EXPORT_SCRIPT, '--out', bpOutDir, '--base', BASE_PATH], {
    env: {
      ...process.env,
      DIFFWIKI_HOME: bpHome,
      DIFFWIKI_STATIC: '1',
      DIFFWIKI_STATIC_DIR: bpStaticDir,
    },
    timeout: 120_000,
  });
}, 420_000);

afterAll(async () => {
  if (bpHome) await fs.rm(bpHome, { recursive: true, force: true });
  if (bpStaticDir) await fs.rm(bpStaticDir, { recursive: true, force: true });
});

describe('static export harness — sub-path base', () => {
  it('emits .nojekyll under the sub-path output', async () => {
    await expect(fs.access(path.join(bpOutDir, '.nojekyll'))).resolves.toBeUndefined();
  });

  it('emits nav-tree.json under sub-path output', async () => {
    const raw = await fs.readFile(path.join(bpOutDir, '_data', 'nav-tree.json'), 'utf8');
    expect(Array.isArray(JSON.parse(raw))).toBe(true);
  });

  it('emits search-index.json under sub-path output', async () => {
    const raw = await fs.readFile(path.join(bpOutDir, 'search-index.json'), 'utf8');
    const idx = JSON.parse(raw);
    expect(Array.isArray(idx)).toBe(true);
    // Tags must still be populated regardless of base path.
    const intro = idx.find((d: { slug: string }) => d.slug === 'intro');
    expect(intro?.tags).toContain('overview');
  });

  it('emits client assets under sub-path output', async () => {
    const assetsDir = path.join(bpOutDir, 'assets');
    const assets = await fs.readdir(assetsDir).catch(() => [] as string[]);
    expect(assets.filter((f) => f.endsWith('.js')).length).toBeGreaterThan(0);
  });

  it('prerenders home HTML that references assets under the sub-path', async () => {
    const html = await fs.readFile(path.join(bpOutDir, 'index.html'), 'utf8');
    expect(html).toContain('<html');
    // The base-path bundle bakes DIFFWIKI_BASE into asset URLs. The SSR'd HTML
    // must link its CSS + JS bundle under /my-wiki/, not the root — otherwise a
    // GitHub Pages sub-path deploy would 404 all assets.
    expect(html).toMatch(/(href|src)="\/my-wiki\/assets\/[^"]+\.css"/);
    expect(html).toMatch(/(href|src)="\/my-wiki\/assets\/[^"]+\.js"/);
    // No asset should be linked at the bare root (would break under the sub-path).
    expect(html).not.toMatch(/(href|src)="\/assets\//);
  });

  it('prerenders the nested article HTML under the sub-path', async () => {
    const html = await fs.readFile(path.join(bpOutDir, 'notes', 'guide', 'setup', 'index.html'), 'utf8');
    expect(html).toContain('<html');
    expect(html).toMatch(/(href|src)="\/my-wiki\/assets\//);
  });

  it('bakes the sub-path prefix into the client data-fetch base', async () => {
    // data-source.ts builds data URLs as `${origin}${BASE_URL}_data/…`; the
    // sub-path prefix must be baked into the shipped client bundle so runtime
    // _data / search-index fetches resolve under /my-wiki/ on the static host.
    const assetsDir = path.join(bpOutDir, 'assets');
    const jsFiles = (await fs.readdir(assetsDir)).filter((f) => f.endsWith('.js'));
    let sawBase = false;
    for (const f of jsFiles) {
      const src = await fs.readFile(path.join(assetsDir, f), 'utf8');
      if (src.includes('/my-wiki/')) {
        sawBase = true;
        break;
      }
    }
    expect(sawBase).toBe(true);
  });
});
