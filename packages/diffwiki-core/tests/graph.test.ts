import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLinkGraph, invalidateLinkGraph, localGraph } from '../src/graph';

let home: string;

/**
 * Seed two collections whose link/tag structure exercises every graph edge case:
 *   notes/intro        route link, relative sibling, cross-collection link, + external & dead (dropped)
 *   notes/alpha        relative link back to intro; tag #howto
 *   notes/guide/setup  relative parent link; tag #howto (co-tagged with alpha, unlinked to it)
 *   notes/manual       folder index (manual/index.md) linking its ./deep subpage
 *   notes/manual/deep  leaf subpage
 *   refs/spec          a second collection, so subset filtering has something to exclude
 */
async function seed(homeDir: string): Promise<void> {
  const notes = path.join(homeDir, 'collections', 'notes');
  const guide = path.join(notes, 'guide');
  const manual = path.join(notes, 'manual');
  const refs = path.join(homeDir, 'collections', 'refs');
  await fs.mkdir(guide, { recursive: true });
  await fs.mkdir(manual, { recursive: true });
  await fs.mkdir(refs, { recursive: true });

  await fs.writeFile(
    path.join(notes, 'intro.md'),
    `---\ntitle: Intro\n---\n\n# Intro\n\nSee [setup](/notes/guide/setup) and [alpha](./alpha) and [spec](/refs/spec) and [external](https://example.com) and [dead](/notes/missing).\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(notes, 'alpha.md'),
    `---\ntitle: Alpha\ntags:\n  - howto\n---\n\n# Alpha\n\nBack to [intro](./intro.md).\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(guide, 'setup.md'),
    `---\ntitle: Setup\ntags:\n  - howto\n---\n\n# Setup\n\nReturn to [intro](../intro).\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(manual, 'index.md'),
    `---\ntitle: Manual\n---\n\n# Manual\n\nRead the [deep dive](./deep).\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(manual, 'deep.md'),
    `---\ntitle: Deep\n---\n\n# Deep\n\nA subpage of the manual.\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(refs, 'spec.md'),
    `---\ntitle: Spec\n---\n\n# Spec\n\nAn out-of-collection reference.\n`,
    'utf8',
  );

  const registry = {
    version: '1',
    collections: [
      { name: 'notes', type: 'global', path: notes, createdAt: new Date().toISOString() },
      { name: 'refs', type: 'global', path: refs, createdAt: new Date().toISOString() },
    ],
  };
  await fs.writeFile(path.join(homeDir, 'registry.json'), JSON.stringify(registry), 'utf8');
  await fs.writeFile(path.join(homeDir, 'config.json'), JSON.stringify({ defaultCollection: 'notes' }), 'utf8');
}

beforeAll(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-graph-')));
  process.env.DIFFWIKI_HOME = home;
  await seed(home);
  invalidateLinkGraph();
});

afterAll(async () => {
  invalidateLinkGraph();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

describe('buildLinkGraph', () => {
  // Cold build renders every fixture through Shiki; a generous timeout avoids the flaky 5s cap.
  it('emits one node per article, including folder index pages', { timeout: 30_000 }, async () => {
    const g = await buildLinkGraph();
    const ids = g.nodes
      .filter((n) => n.kind === 'article')
      .map((n) => n.id)
      .sort();
    expect(ids).toEqual([
      'notes/alpha',
      'notes/guide/setup',
      'notes/intro',
      'notes/manual',
      'notes/manual/deep',
      'refs/spec',
    ]);
  });

  it('makes a folder index page a node carrying its links to subpages', async () => {
    const g = await buildLinkGraph();
    const manual = g.nodes.find((n) => n.id === 'notes/manual');
    expect(manual).toMatchObject({ kind: 'article', coll: 'notes', slug: 'manual', title: 'Manual' });
    expect(g.edges).toContainEqual({ source: 'notes/manual', target: 'notes/manual/deep', kind: 'link' });
    expect(localGraph(g, 'notes/manual').nodes.map((n) => n.id)).toContain('notes/manual/deep');
  });

  it('resolves route, relative, cross-collection and parent links, dropping external and dead ones', async () => {
    const g = await buildLinkGraph();
    const edges = g.edges
      .filter((e) => e.kind === 'link')
      .map((e) => `${e.source}->${e.target}`)
      .sort();
    expect(edges).toEqual([
      'notes/alpha->notes/intro',
      'notes/guide/setup->notes/intro',
      'notes/intro->notes/alpha',
      'notes/intro->notes/guide/setup',
      'notes/intro->refs/spec',
      'notes/manual->notes/manual/deep',
    ]);
    expect(edges).not.toContain('notes/intro->notes/missing');
  });

  it('emits one tag hub per distinct tag with a membership edge from each tagged article', async () => {
    const g = await buildLinkGraph();
    expect(g.nodes.find((n) => n.id === 'tag:howto')).toMatchObject({
      kind: 'tag',
      coll: '',
      slug: '',
      title: '#howto',
    });
    const tagEdges = g.edges
      .filter((e) => e.kind === 'tag')
      .map((e) => `${e.source}->${e.target}`)
      .sort();
    expect(tagEdges).toEqual(['notes/alpha->tag:howto', 'notes/guide/setup->tag:howto']);
  });
});

describe('localGraph', () => {
  it('slices an untagged page down to its direct link neighbours', async () => {
    const g = await buildLinkGraph();
    const local = localGraph(g, 'notes/intro');
    expect(local.focus).toBe('notes/intro');
    const ids = local.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['notes/alpha', 'notes/guide/setup', 'notes/intro', 'refs/spec']);
  });

  it('pulls in the tag hub and 2-hop co-tagged siblings, not just linked neighbours', async () => {
    const g = await buildLinkGraph();
    const local = localGraph(g, 'notes/alpha');
    const ids = local.nodes.map((n) => n.id).sort();
    expect(ids).toContain('notes/intro'); // linked
    expect(ids).toContain('tag:howto'); // own tag hub
    expect(ids).toContain('notes/guide/setup'); // co-tagged sibling, though unlinked
    expect(local.edges).toContainEqual({ source: 'notes/guide/setup', target: 'tag:howto', kind: 'tag' });
  });

  it('returns a focused empty graph for an unknown node', async () => {
    const g = await buildLinkGraph();
    expect(localGraph(g, 'notes/does-not-exist')).toEqual({ focus: 'notes/does-not-exist', nodes: [], edges: [] });
  });

  it('prunes neighbours outside the include set (subset-export parity)', async () => {
    const g = await buildLinkGraph();
    expect(localGraph(g, 'notes/intro').nodes.map((n) => n.id)).toContain('refs/spec');
    const scoped = localGraph(g, 'notes/intro', new Set(['notes']));
    expect(scoped.nodes.map((n) => n.id).sort()).toEqual(['notes/alpha', 'notes/guide/setup', 'notes/intro']);
    expect(scoped.edges.every((e) => !e.source.startsWith('refs/') && !e.target.startsWith('refs/'))).toBe(true);
  });
});
