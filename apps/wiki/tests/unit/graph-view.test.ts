import { describe, it, expect } from 'vitest';
import { deriveGraphView } from '../../src/lib/graph-view';
import type { LinkGraph } from '../../src/lib/types';

// Articles a→b (link); a, b, c all carry #shared (a also #solo) — so every article pair shares one tag.
const base: LinkGraph = {
  nodes: [
    { id: 'n/a', kind: 'article', coll: 'n', slug: 'a', title: 'A' },
    { id: 'n/b', kind: 'article', coll: 'n', slug: 'b', title: 'B' },
    { id: 'n/c', kind: 'article', coll: 'n', slug: 'c', title: 'C' },
    { id: 'tag:shared', kind: 'tag', coll: '', slug: '', title: '#shared' },
    { id: 'tag:solo', kind: 'tag', coll: '', slug: '', title: '#solo' },
  ],
  edges: [
    { source: 'n/a', target: 'n/b', kind: 'link' },
    { source: 'n/a', target: 'tag:shared', kind: 'tag' },
    { source: 'n/b', target: 'tag:shared', kind: 'tag' },
    { source: 'n/c', target: 'tag:shared', kind: 'tag' },
    { source: 'n/a', target: 'tag:solo', kind: 'tag' },
  ],
};

const key = (e: { source: string; target: string }) =>
  e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;

describe('deriveGraphView', () => {
  it('hubs mode keeps tag nodes and every edge, all weight 1', () => {
    const v = deriveGraphView(base, 'hubs');
    expect(v.nodes).toHaveLength(5);
    expect(v.nodes.some((n) => n.id === 'tag:shared')).toBe(true);
    expect(v.edges).toHaveLength(5);
    expect(v.edges.every((e) => e.weight === 1 && e.render)).toBe(true);
  });

  it('proximity mode renders only links; shared tags become invisible force edges', () => {
    const v = deriveGraphView(base, 'proximity');
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['n/a', 'n/b', 'n/c']);
    expect(v.nodes.every((n) => n.kind === 'article')).toBe(true);
    const rendered = v.edges.filter((e) => e.render);
    const forceOnly = v.edges.filter((e) => !e.render);
    expect(rendered).toEqual([{ source: 'n/a', target: 'n/b', kind: 'link', weight: 1, render: true }]);
    expect(forceOnly).toHaveLength(3);
    expect(forceOnly.every((e) => e.kind === 'tag' && !e.render && e.weight >= 1)).toBe(true);
    expect(forceOnly.map((e) => key(e)).sort()).toEqual(['n/a|n/b', 'n/a|n/c', 'n/b|n/c']);
  });
});
