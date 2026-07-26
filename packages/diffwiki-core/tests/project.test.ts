import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectConfig, readSiteConfig, resolveProjectCollections, seedProjectHome } from '../src/project';

let dir: string;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-proj-')));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = (yaml: string) => fs.writeFile(path.join(dir, 'diffwiki.yaml'), yaml, 'utf8');

describe('readProjectConfig', () => {
  it('returns undefined when diffwiki.yaml is absent', async () => {
    expect(await readProjectConfig(dir)).toBeUndefined();
  });

  it('parses the extended form (site + collections)', async () => {
    await write(
      [
        'site:',
        '  repo: https://example.com/repo',
        '  home:',
        '    tagline: hello',
        '    cards:',
        '      - icon: rocket',
        '        title: Getting Started',
        '        subtitle: Start here',
        '        link: /getting-started',
        '      - title: No Icon',
        '        link: /x',
        'collections:',
        '  - name: getting-started',
        '    path: wiki/getting-started',
        '  - name: user-guide',
        '    path: wiki/user-guide',
      ].join('\n'),
    );
    const cfg = await readProjectConfig(dir);
    expect(cfg?.collections).toEqual([
      { name: 'getting-started', path: 'wiki/getting-started' },
      { name: 'user-guide', path: 'wiki/user-guide' },
    ]);
    expect(cfg?.site?.repo).toBe('https://example.com/repo');
    expect(cfg?.site?.home?.tagline).toBe('hello');
    expect(cfg?.site?.home?.cards).toEqual([
      { icon: 'rocket', title: 'Getting Started', subtitle: 'Start here', link: '/getting-started' },
      { title: 'No Icon', link: '/x' },
    ]);
  });

  it('sorts collections by explicit `order`, list order as tiebreak', async () => {
    await write(
      [
        'collections:',
        '  - name: b',
        '    path: wiki/b',
        '    order: 2',
        '  - name: a',
        '    path: wiki/a',
        '    order: 1',
        '  - name: c', // no order → sorts after the ordered ones
        '    path: wiki/c',
      ].join('\n'),
    );
    const cfg = await readProjectConfig(dir);
    expect(cfg?.collections.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(cfg?.collections.find((c) => c.name === 'a')?.order).toBe(1);
  });

  it('parses site.copyright as { text, url } and as a bare string', async () => {
    await write(['site:', '  copyright:', '    text: © 2026 Acme, Inc.', '    url: https://acme.example'].join('\n'));
    expect((await readProjectConfig(dir))?.site?.copyright).toEqual({
      text: '© 2026 Acme, Inc.',
      url: 'https://acme.example',
    });

    await write(['site:', '  copyright: © 2026 Acme, Inc.'].join('\n'));
    expect((await readProjectConfig(dir))?.site?.copyright).toEqual({ text: '© 2026 Acme, Inc.' });
  });

  it('folds the legacy { collection, path } form into one collection', async () => {
    await write('collection: my-wiki\npath: wiki\n');
    const cfg = await readProjectConfig(dir);
    expect(cfg?.collections).toEqual([{ name: 'my-wiki', path: 'wiki' }]);
    expect(cfg?.site).toBeUndefined();
  });

  it('resolveProjectCollections yields absolute paths of type repo', async () => {
    await write('collections:\n  - name: a\n    path: wiki/a\n');
    const entries = await resolveProjectCollections(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'a', type: 'repo', path: path.join(dir, 'wiki', 'a') });
  });

  it('readSiteConfig returns {} when no site block', async () => {
    await write('collections:\n  - name: a\n    path: wiki/a\n');
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it('seedProjectHome writes a registry from diffwiki.yaml collections', async () => {
    await write('collections:\n  - name: a\n    path: wiki/a\n  - name: b\n    path: wiki/b\n');
    const { home } = await seedProjectHome(dir);
    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8'));
    expect(registry.collections.map((c: { name: string }) => c.name)).toEqual(['a', 'b']);
    expect(registry.collections[0].path).toBe(path.join(dir, 'wiki', 'a'));
    await fs.rm(home, { recursive: true, force: true });
  });

  it('seedProjectHome throws when there are no collections', async () => {
    await expect(seedProjectHome(dir)).rejects.toThrow(/No collections to render/);
  });
});
