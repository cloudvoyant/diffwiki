import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '../src/collections';
import { buildCollections } from '../src/site';

// Mock only the provider loader so search() takes the plugin path with a fake
// engine we control; everything else (registry, config, filtering) is real.
vi.mock('../src/plugins/host', () => ({ loadSearchProvider: vi.fn() }));
import { search } from '../src/query';
import { loadSearchProvider } from '../src/plugins/host';
import type { SearchProvider } from '../src/types';

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-'));
  process.env.DIFFWIKI_HOME = home;
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  vi.clearAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe('buildCollections + system audience', () => {
  it('hides system collections by default, shows them with showSystem', async () => {
    await createCollection('kb');
    await createCollection('transcripts', { audience: 'system' });
    const hidden = await buildCollections();
    expect(hidden.map((c) => c.name)).toContain('kb');
    expect(hidden.map((c) => c.name)).not.toContain('transcripts');
    const shown = await buildCollections({ showSystem: true });
    expect(shown.map((c) => c.name)).toContain('transcripts');
  });
});

describe('search + system audience', () => {
  /** A fake engine that ignores `searchable` and returns hits from every collection. */
  function stubProvider(): void {
    const provider = {
      name: 'stub',
      capabilities: { searchTypes: ['keyword'], collectionFilter: true, events: false },
      // The transcripts hit gets a deliberately broken path — mirrors the real
      // bug where mapHits can't resolve an excluded collection — to prove the
      // drop is by collection audience, not by re-reading the file.
      handleSearch: async () => [
        { collection: 'kb', path: path.join(home, 'collections', 'kb', 'a.md'), title: 'KB', tags: [] },
        { collection: 'transcripts', path: 'broken/relative/path.md', title: 'Worked on', tags: [] },
      ],
      reindex: async () => 0,
      emitEvent: async () => {},
      health: async () => ({ ready: true, diagnostics: [] }),
    };
    vi.mocked(loadSearchProvider).mockResolvedValue(provider as unknown as SearchProvider);
  }

  it('drops hits from system collections that a plugin returns despite exclusion', async () => {
    await createCollection('kb');
    await createCollection('transcripts', { audience: 'system' });
    await fs.writeFile(path.join(home, 'collections', 'kb', 'a.md'), '---\ntitle: A\n---\n\nbody', 'utf8');
    stubProvider();

    const outcome = await search('anything', { engine: 'stub' });
    expect(outcome.hits.map((h) => h.collection)).toContain('kb');
    expect(outcome.hits.map((h) => h.collection)).not.toContain('transcripts');
  });

  it('includes system-collection hits when showSystem is set', async () => {
    await createCollection('kb');
    await createCollection('transcripts', { audience: 'system' });
    await fs.writeFile(path.join(home, 'collections', 'kb', 'a.md'), '---\ntitle: A\n---\n\nbody', 'utf8');
    stubProvider();

    const outcome = await search('anything', { engine: 'stub', showSystem: true });
    expect(outcome.hits.map((h) => h.collection)).toContain('transcripts');
  });
});
