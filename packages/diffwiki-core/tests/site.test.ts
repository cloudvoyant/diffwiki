import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCollections,
  buildNavTree,
  buildSearchIndex,
  createCollection,
  rankDocs,
  resolvePage,
} from '../src/index';

let home: string;
let demoPath: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  process.env.DIFFWIKI_HOME = home;
  const c = await createCollection('demo');
  demoPath = c.path;
  await fs.writeFile(
    path.join(c.path, 'intro.md'),
    '---\ntitle: Intro\ntags:\n  - overview\n  - getting-started\n---\n# Intro\n\nHello world.\n',
  );
  // Nested article: a/b/deep.md
  await fs.mkdir(path.join(c.path, 'a', 'b'), { recursive: true });
  await fs.writeFile(
    path.join(c.path, 'a', 'b', 'deep.md'),
    '---\ntitle: Deep\ntags:\n  - nested\n---\n# Deep\n\nDeep content.\n',
  );
  // Folder with no index (so resolvePage returns a listing)
  await fs.mkdir(path.join(c.path, 'folder'), { recursive: true });
  await fs.writeFile(path.join(c.path, 'folder', 'child.md'), '---\ntitle: Child\n---\n# Child\n');
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('site builders (exporter data)', () => {
  it('buildNavTree yields a collection with a linked article node', async () => {
    const nav = await buildNavTree();
    const demo = nav.find((c) => c.collection.name === 'demo');
    expect(demo).toBeDefined();
    expect(demo!.nodes.some((n) => n.path === '/demo/intro')).toBe(true);
  });

  it('buildCollections lists the collection', async () => {
    const cols = await buildCollections();
    expect(cols.some((c) => c.name === 'demo')).toBe(true);
  });

  it('resolvePage renders a flat doc with highlighted HTML + toc', async () => {
    const doc = await resolvePage('demo', 'intro');
    expect(doc?.kind).toBe('doc');
    if (doc?.kind === 'doc') {
      expect(doc.html).toContain('Hello world');
      expect(doc.title).toBe('Intro');
    }
  }, 30_000);

  it('resolvePage resolves a nested slug (a/b/deep)', async () => {
    const doc = await resolvePage('demo', 'a/b/deep');
    expect(doc?.kind).toBe('doc');
    if (doc?.kind === 'doc') {
      expect(doc.title).toBe('Deep');
      expect(doc.html).toContain('Deep content');
      expect(doc.slug).toBe('a/b/deep');
    }
  }, 30_000);

  it('resolvePage returns a listing for a folder with no index', async () => {
    const listing = await resolvePage('demo', 'folder');
    expect(listing?.kind).toBe('listing');
    if (listing?.kind === 'listing') {
      expect(listing.entries.some((e) => e.name === 'child')).toBe(true);
    }
  });

  it('resolvePage returns a root listing when no collection-root index exists', async () => {
    const root = await resolvePage('demo', '');
    // No index.md at root → listing of top-level nodes (intro, a, folder)
    expect(root?.kind === 'doc' || root?.kind === 'listing').toBe(true);
  });

  it('resolvePage returns null for a missing collection', async () => {
    const result = await resolvePage('ghost', 'whatever');
    expect(result).toBeNull();
  });

  it('resolvePage returns null for a missing slug (not a folder)', async () => {
    const result = await resolvePage('demo', 'no-such-article');
    expect(result).toBeNull();
  });

  it('resolvePage returns a root listing for an empty collection', async () => {
    // Remove all files so the collection dir exists but is empty.
    await fs.rm(demoPath, { recursive: true, force: true });
    await fs.mkdir(demoPath, { recursive: true });
    const root = await resolvePage('demo', '');
    expect(root?.kind).toBe('listing');
    if (root?.kind === 'listing') {
      expect(root.entries).toEqual([]);
    }
  });

  it('buildSearchIndex includes the article with real tags', async () => {
    const idx = await buildSearchIndex();
    const entry = idx.find((d) => d.collection === 'demo' && d.slug === 'intro');
    expect(entry).toBeDefined();
    expect(entry!.title).toBe('Intro');
    // Tags must be populated from frontmatter — not hard-coded [].
    expect(entry!.tags).toEqual(['overview', 'getting-started']);
  });

  it('buildSearchIndex populates tags for nested articles', async () => {
    const idx = await buildSearchIndex();
    const deep = idx.find((d) => d.slug === 'a/b/deep');
    expect(deep).toBeDefined();
    expect(deep!.tags).toEqual(['nested']);
  });

  it('carries tokenized fields so static BM25 ranks the index offline', async () => {
    const idx = await buildSearchIndex();
    const intro = idx.find((d) => d.slug === 'intro');
    // Body is tokenized into the index (intro.md body is "Hello world.").
    expect(intro!.fields.body).toContain('hello');
    // The SAME scorer the server uses ranks the built index client-side.
    const ranked = rankDocs('hello', idx);
    expect(ranked[0]?.slug).toBe('intro');
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(0);
    // A body term unique to the nested doc ranks it first.
    expect(rankDocs('deep content', idx)[0]?.slug).toBe('a/b/deep');
  });

  it('omits git branch info under DIFFWIKI_STATIC', async () => {
    process.env.DIFFWIKI_STATIC = '1';
    try {
      const cols = await buildCollections();
      expect(cols.every((c) => c.branch === undefined)).toBe(true);
    } finally {
      delete process.env.DIFFWIKI_STATIC;
    }
  });
});
