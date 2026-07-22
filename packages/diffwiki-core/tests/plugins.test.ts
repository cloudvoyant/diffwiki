import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createArticle,
  createCollection,
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
 * It speaks newline-delimited JSON over stdio: one response line per request id.
 */
const FAKE_PLUGIN = `
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i = buffer.indexOf('\\n');
  while (i >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
    i = buffer.indexOf('\\n');
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

function handle(req) {
  const { id, op, params } = req;
  if (op === 'initialize') {
    send({
      id,
      ok: true,
      result: {
        name: 'stub-plugin',
        kind: 'search',
        version: '0.0.0',
        capabilities: { searchTypes: ['stub'], collectionFilter: true, hooks: false, setup: true },
      },
    });
  } else if (op === 'search') {
    const first = (params.collections || [])[0];
    const collection = first ? first.name : 'unknown';
    send({
      id,
      ok: true,
      result: { hits: [{ collection, relPath: 'a.md', title: 'Alpha', tags: [] }] },
    });
  } else if (op === 'health') {
    send({
      id,
      ok: true,
      result: {
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
      },
    });
  } else if (op === 'setup') {
    send({ id, ok: true, result: { ready: true, steps: [] } });
  } else if (op === 'index') {
    send({ id, ok: true, result: { indexed: 0 } });
  } else if (op === 'notify') {
    send({ id, ok: true, result: { accepted: true } });
  } else if (op === 'shutdown') {
    send({ id, ok: true, result: {} });
    process.exit(0);
  } else {
    send({ id, ok: false, error: { message: 'unknown op: ' + op } });
  }
}
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

describe('protocol client + loader', () => {
  it('handshakes and maps a hit to an absolute path', async () => {
    const entry: CollectionEntry = await createCollection('notes');
    await registerStubPlugin();

    const provider = await loadSearchProvider('stub-plugin');
    expect(provider).not.toBeNull();
    try {
      expect(provider!.name).toBe('stub-plugin');
      expect(provider!.capabilities.searchTypes).toEqual(['stub']);
      const hits = await provider!.search('anything', [entry], {});
      expect(hits).toHaveLength(1);
      expect(hits[0].collection).toBe('notes');
      expect(hits[0].title).toBe('Alpha');
      expect(hits[0].path).toBe(path.join(entry.path, 'a.md'));
    } finally {
      await provider!.close();
    }
  });

  it('lists native FIRST, then the plugin modes', async () => {
    await registerStubPlugin();
    const modes = await listSearchModes();
    expect(modes[0]).toEqual({ plugin: 'native', type: 'basic', label: 'native · title/tags' });
    expect(modes).toContainEqual({
      plugin: 'stub-plugin',
      type: 'stub',
      label: 'stub-plugin · stub',
    });
  });

  it('lists only native when no plugin is registered', async () => {
    const modes = await listSearchModes();
    expect(modes).toEqual([{ plugin: 'native', type: 'basic', label: 'native · title/tags' }]);
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
    expect(all.map((h) => h.title).sort()).toEqual(['Clean note', 'auth-guards']);
    // The malformed file degrades to its filename and stays findable by it.
    const byName = await query('auth-guards', { collection: 'router' });
    expect(byName.map((h) => h.path)).toEqual([path.join(entry.path, 'auth-guards.md')]);
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
});
