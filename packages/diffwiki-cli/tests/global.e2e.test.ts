import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-e2e-'));
  // Resolve symlinks (important on macOS where /tmp is a symlink to /private/tmp)
  home = await fs.realpath(home);
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('global lifecycle', () => {
  it('create → config → add → list → query → update → tags → remove', async () => {
    expect((await run(['create', 'notes'])).ok).toBe(true);
    expect((await run(['config-set', 'defaultCollection', 'notes'])).ok).toBe(true);

    const added = await run(['add-article', '-p', 'notes:Hello World', '-t', 'a,b', '-t', 'c', '# Hi']);
    expect(added.ok).toBe(true);
    const articlePath = added.out.trim();
    expect(articlePath.endsWith('hello-world.md')).toBe(true);
    await fs.access(articlePath); // file really exists

    const list = await run(['list']);
    expect(list.out).toContain('notes');
    expect(list.out).toContain('[global]');

    const q = await run(['query', 'hello']);
    expect(q.out).toContain('Hello World');

    // default-collection path: no "collection:" prefix
    const added2 = await run(['add-article', '-p', 'From Default', '-t', 'x']);
    expect(added2.ok).toBe(true);

    expect((await run(['update-article', '-p', 'notes:hello-world', '# Hi again'])).ok).toBe(true);
    expect((await run(['add-tags', '-p', 'notes:hello-world', 'd,e'])).ok).toBe(true);
    expect((await run(['remove-tags', '-p', 'notes:hello-world', 'a'])).ok).toBe(true);
    const setTags = await run(['update-tags', '-p', 'notes:hello-world', 'only']);
    expect(setTags.out).toContain('only');

    expect((await run(['remove-article', '-p', 'notes:hello-world'])).ok).toBe(true);
    await expect(fs.access(articlePath)).rejects.toBeTruthy();
  });

  it('reports a clean error for a duplicate collection', async () => {
    await run(['create', 'dup']);
    const second = await run(['create', 'dup']);
    expect(second.ok).toBe(false);
    expect(second.err).toContain('already exists');
  });

  it('reports a clean error when no default collection is set', async () => {
    const res = await run(['add-article', '-p', 'Orphan', '-t', 'x']);
    expect(res.ok).toBe(false);
    expect(res.err).toContain('no default collection');
  });
});
