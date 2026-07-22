import { describe, it, expect } from 'vitest';
import { hitToResult } from '../../src/lib/search';
import type { QueryHit, CollectionEntry } from 'diffwiki-core';

const collections: CollectionEntry[] = [
  { name: 'notes', type: 'global', path: '/home/u/.diffwiki/collections/notes', createdAt: '2026-01-01T00:00:00Z' },
  { name: 'myrepo-wiki', type: 'repo', path: '/home/u/projects/myrepo/.wiki', createdAt: '2026-01-01T00:00:00Z' },
];

describe('hitToResult', () => {
  it('maps an absolute path under a known collection to a relative, extension-less slug', () => {
    const hit: QueryHit = {
      collection: 'notes',
      path: '/home/u/.diffwiki/collections/notes/guide/setup.mdx',
      title: 'Setting Up',
      tags: ['setup'],
    };
    expect(hitToResult(hit, collections)).toEqual({
      coll: 'notes',
      slug: 'guide/setup',
      title: 'Setting Up',
      snippet: undefined,
    });
  });

  it('strips a top-level .md extension', () => {
    const hit: QueryHit = {
      collection: 'notes',
      path: '/home/u/.diffwiki/collections/notes/intro.md',
      title: 'Introduction',
      tags: [],
    };
    expect(hitToResult(hit, collections).slug).toBe('intro');
  });

  it('matches an in-repo wiki at an arbitrary path outside ~/.diffwiki', () => {
    const hit: QueryHit = {
      collection: 'myrepo-wiki',
      path: '/home/u/projects/myrepo/.wiki/architecture.md',
      title: 'Architecture',
      tags: [],
    };
    const result = hitToResult(hit, collections);
    expect(result.coll).toBe('myrepo-wiki');
    expect(result.slug).toBe('architecture');
  });

  it('falls back to basename when the hit path is not under any registered collection', () => {
    const hit: QueryHit = {
      collection: 'ghost',
      path: '/somewhere/completely/different/orphan.md',
      title: 'Orphan',
      tags: [],
    };
    expect(hitToResult(hit, collections)).toEqual({
      coll: 'ghost',
      slug: 'orphan',
      title: 'Orphan',
      snippet: undefined,
    });
  });

  it('forwards snippet when provided by a plugin', () => {
    const hit: QueryHit = {
      collection: 'notes',
      path: '/home/u/.diffwiki/collections/notes/intro.md',
      title: 'Intro',
      tags: [],
      snippet: 'Welcome to diffwiki…',
    };
    expect(hitToResult(hit, collections).snippet).toBe('Welcome to diffwiki…');
  });
});
