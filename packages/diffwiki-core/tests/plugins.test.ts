import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createArticle,
  createCollection,
  listAvailablePlugins,
  listSearchModes,
  loadSearchProvider,
  query,
  registerCollection,
  upsertPlugin,
} from '../src/index';
import type { CollectionEntry } from '../src/types';

let home: string;
let scratch: string[];

/**
 * A minimal but real protocol plugin, written to disk and spawned as `node <file>`.
 * It speaks the one-shot JSON-over-stdio protocol: read one JSON request from
 * stdin, write one JSON response to stdout, then exit.
 */
const FAKE_PLUGIN = `
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
});
process.stdin.on('end', () => {
  const line = buffer.trim();
  if (!line) { process.exit(1); return; }
  const req = JSON.parse(line);
  const { op, params } = req;
  let result;
  if (op === 'describe') {
    result = {
      name: 'stub-plugin',
      kind: 'search',
      version: '0.0.0',
      capabilities: { searchTypes: ['stub'], collectionFilter: true, events: false },
    };
  } else if (op === 'search') {
    const first = (params.collections || [])[0];
    const collection = first ? first.name : 'unknown';
    result = { hits: [{ collection, relPath: 'a.md', title: 'Alpha', tags: [] }] };
  } else if (op === 'health') {
    result = {
      ready: true,
      readiness: {
        toolInstalled: true,
        modelsPresent: true,
        indexBuilt: true,
        docsIndexed: 1,
        embeddingsPending: 0,
        firstSearchCost: 'instant',
      },
      diagnostics: [{ level: 'ok', message: 'stub ready' }],
    };
  } else if (op === 'setup') {
    result = { ready: true, steps: [] };
  } else if (op === 'index') {
    result = { indexed: 0 };
  } else if (op === 'event') {
    result = { accepted: true };
  } else {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: 'unknown op: ' + op } }) + '\\n');
    process.exit(1);
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\\n');
  process.exit(0);
});
`;

async function writeFakePlugin(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-plugin-'));
  scratch.push(dir);
  const file = path.join(dir, 'fake-plugin.mjs');
  await fs.writeFile(file, FAKE_PLUGIN, 'utf8');
  return file;
}

async function registerStubPlugin(): Promise<void> {
  const file = await writeFakePlugin();
  await upsertPlugin({
    name: 'stub-plugin',
    kind: 'search',
    command: [process.execPath, file],
    capabilities: { searchTypes: ['stub'], collectionFilter: true, events: false },
    enabled: true,
    managed: false,
  });
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-'));
  process.env.DIFFWIKI_HOME = home;
  scratch = [];
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
  for (const dir of scratch) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('one-shot protocol client + loader', () => {
  it('describes and maps a hit to an absolute path', async () => {
    const entry: CollectionEntry = await createCollection('notes');
    await registerStubPlugin();

    const provider = await loadSearchProvider('stub-plugin');
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('stub-plugin');
    expect(provider!.capabilities.searchTypes).toEqual(['stub']);
    const hits = await provider!.handleSearch('anything', [entry], {});
    expect(hits).toHaveLength(1);
    expect(hits[0].collection).toBe('notes');
    expect(hits[0].title).toBe('Alpha');
    expect(hits[0].path).toBe(path.join(entry.path, 'a.md'));
  });

  it('lists native FIRST, then the plugin modes from cached capabilities', async () => {
    await registerStubPlugin();
    const modes = await listSearchModes();
    expect(modes[0]).toEqual({ plugin: 'native', type: 'basic', label: 'native · bm25' });
    expect(modes).toContainEqual({
      plugin: 'stub-plugin',
      type: 'stub',
      label: 'stub-plugin · stub',
    });
  });

  it('lists only native when no plugin is registered', async () => {
    const modes = await listSearchModes();
    expect(modes).toEqual([{ plugin: 'native', type: 'basic', label: 'native · bm25' }]);
  });
});

describe('available plugins catalog', () => {
  it('lists the official plugins available to install', () => {
    const names = listAvailablePlugins().map((k) => k.name);
    expect(names).toContain('diffwiki-qmd');
    expect(names).toContain('diffwiki-ripgrep');
    for (const k of listAvailablePlugins()) {
      expect(k.kind).toBe('search');
      expect(k.spec.length).toBeGreaterThan(0);
      expect(k.description.length).toBeGreaterThan(0);
    }
  });
});

describe('native search (no plugin)', () => {
  it('matches by tag when the title and body do not contain the term', async () => {
    await createCollection('notes');
    await createArticle({ target: 'notes:Grocery list', tags: ['kubernetes'], body: '# shopping' });
    const hits = await query('kubernetes');
    expect(hits.map((h) => h.title)).toEqual(['Grocery list']);
  });

  it('matches by collection name when the title and body do not contain the term', async () => {
    await createCollection('devops');
    await createArticle({ target: 'devops:Random note', tags: ['misc'], body: '# nothing here' });
    const hits = await query('devops');
    expect(hits.map((h) => h.title)).toEqual(['Random note']);
  });

  it('does not fail the whole search on one article with malformed frontmatter', async () => {
    const entry = await createCollection('router');
    // An unquoted colon in the title (`title: A: B`) is rejected by the strict
    // YAML engine — this file must be skipped/degraded, not blow up the search.
    await fs.writeFile(
      path.join(entry.path, 'auth-guards.md'),
      '---\ntitle: TanStack Router: Protecting Routes with Auth Guards\n---\n\n# body\n',
      'utf8',
    );
    await createArticle({ target: 'router:Clean note', tags: [], body: '# ok' });

    // Whole-collection query must not throw, and must still return the good file.
    const all = await query('', { collection: 'router' });
    expect(all.map((h) => h.title).sort()).toEqual([
      'Clean note',
      'TanStack Router: Protecting Routes with Auth Guards',
    ]);
    // The malformed file is now parsed leniently (title extracted by regex).
    const byName = await query('auth', { collection: 'router' });
    expect(byName.some((h) => h.path === path.join(entry.path, 'auth-guards.md'))).toBe(true);
  });

  it('searches a collection whose path lives OUTSIDE ~/.diffwiki (registry path)', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-repo-'));
    scratch.push(repo);
    const wikiDir = path.join(repo, 'docs', 'wiki');
    await fs.mkdir(wikiDir, { recursive: true });
    await fs.writeFile(
      path.join(wikiDir, 'external.md'),
      '---\ntitle: External Article\ntags: []\n---\n\n# body\n',
      'utf8',
    );
    await registerCollection({
      name: 'repo-wiki',
      type: 'repo',
      path: wikiDir,
      createdAt: new Date().toISOString(),
    });

    const hits = await query('external');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('External Article');
    expect(hits[0].path).toBe(path.join(wikiDir, 'external.md'));
  });

  it('ranks a title match above a body-only match (BM25)', async () => {
    await createCollection('ranking');
    await createArticle({
      target: 'ranking:Kubernetes Setup Guide',
      tags: [],
      body: '# Setting up k8s\n\nGeneral instructions for deployment.',
    });
    await createArticle({
      target: 'ranking:Grocery List',
      tags: [],
      body: '# Shopping\n\nBuy some kubernetes stickers from the store.',
    });
    const hits = await query('kubernetes', { collection: 'ranking' });
    expect(hits.length).toBe(2);
    // The article with "kubernetes" in the title should rank first
    expect(hits[0].title).toBe('Kubernetes Setup Guide');
    expect(hits[1].title).toBe('Grocery List');
    // Both should have populated scores
    expect(typeof hits[0].score).toBe('number');
    expect(typeof hits[1].score).toBe('number');
    expect(hits[0].score!).toBeGreaterThan(hits[1].score!);
  });

  it('ranks a tag match above a body-only match (BM25)', async () => {
    await createCollection('tagrank');
    await createArticle({ target: 'tagrank:Note A', tags: ['docker'], body: '# A\n\nSome random content.' });
    await createArticle({
      target: 'tagrank:Note B',
      tags: ['misc'],
      body: '# B\n\nThis article mentions docker in passing.',
    });
    const hits = await query('docker', { collection: 'tagrank' });
    expect(hits.length).toBe(2);
    expect(hits[0].title).toBe('Note A');
    expect(hits[1].title).toBe('Note B');
  });

  it('empty query returns all articles without scores', async () => {
    await createCollection('browseall');
    await createArticle({ target: 'browseall:First', tags: [], body: '# 1' });
    await createArticle({ target: 'browseall:Second', tags: [], body: '# 2' });
    const hits = await query('', { collection: 'browseall' });
    expect(hits.length).toBe(2);
    // No scores on unranked results
    expect(hits[0].score).toBeUndefined();
    expect(hits[1].score).toBeUndefined();
  });

  it('returns no results when no document matches the query term (BM25)', async () => {
    await createCollection('nomatch');
    await createArticle({ target: 'nomatch:Hello World', tags: ['greeting'], body: '# Hi there' });
    const hits = await query('zzzznonexistent', { collection: 'nomatch' });
    expect(hits).toHaveLength(0);
  });
});
