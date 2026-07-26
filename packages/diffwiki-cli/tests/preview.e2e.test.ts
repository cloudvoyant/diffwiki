import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedProjectHome, resolveProjectCollections } from 'diffwiki-core';
import { findFreePort } from '../src/preview';

let root: string;
let globalHome: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-prev-')));

  // Plant a DECOY global ~/.diffwiki with an unrelated collection, and point
  // DIFFWIKI_HOME at it. preview/export --project must IGNORE this entirely — the
  // ephemeral home comes from diffwiki.yaml, never from the ambient DIFFWIKI_HOME.
  globalHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-global-')));
  await fs.writeFile(
    path.join(globalHome, 'registry.json'),
    JSON.stringify({
      version: 1,
      collections: [
        { name: 'decoy', type: 'global', path: path.join(globalHome, 'decoy'), createdAt: '2026-01-01T00:00:00Z' },
      ],
    }),
    'utf8',
  );
  process.env.DIFFWIKI_HOME = globalHome;
});
afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(globalHome, { recursive: true, force: true });
});

describe('preview / export --project (shared seeding)', () => {
  it('seeds an ephemeral registry from diffwiki.yaml, ignoring the global ~/.diffwiki', async () => {
    await fs.mkdir(path.join(root, 'wiki', 'guide'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'diffwiki.yaml'),
      ['collections:', '  - name: guide', '    path: wiki/guide'].join('\n'),
      'utf8',
    );

    const entries = await resolveProjectCollections(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'guide', type: 'repo', path: path.join(root, 'wiki', 'guide') });

    const { home } = await seedProjectHome(root);
    // The seeded home is a FRESH tmp dir, never the ambient DIFFWIKI_HOME (globalHome).
    expect(home).not.toBe(globalHome);
    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8'));
    const names = registry.collections.map((c: { name: string }) => c.name);
    expect(names).toEqual(['guide']); // ONLY the project collection — the decoy is absent
    expect(names).not.toContain('decoy');
    await fs.rm(home, { recursive: true, force: true });
  });

  it('throws when there is no diffwiki.yaml', async () => {
    await expect(seedProjectHome(root)).rejects.toThrow(/No collections to render/);
  });
});

describe('findFreePort', () => {
  it('returns the requested port when it is free', async () => {
    // Grab a free port, release it, then assert findFreePort hands it back.
    const seed = await findFreePort(4373);
    expect(await findFreePort(seed)).toBe(seed);
  });

  it('skips a busy port and returns the next free one', async () => {
    const base = await findFreePort(4501);
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(base, '127.0.0.1', resolve));
    try {
      const got = await findFreePort(base);
      expect(got).toBeGreaterThan(base); // base is occupied → must move past it
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
