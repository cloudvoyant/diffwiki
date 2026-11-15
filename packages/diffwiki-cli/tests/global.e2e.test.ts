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
    expect((await run(['collection', 'create', 'notes'])).ok).toBe(true);
    expect((await run(['config', 'set', 'defaultCollection', 'notes'])).ok).toBe(true);

    const added = await run(['article', 'create', 'notes:Hello World', '-b', '# Hi', '-t', 'a,b', '-t', 'c']);
    expect(added.ok).toBe(true);
    const articlePath = added.out.trim();
    expect(articlePath.endsWith('hello-world.md')).toBe(true);
    await fs.access(articlePath); // file really exists

    const list = await run(['collection', 'list']);
    expect(list.out).toContain('notes');
    expect(list.out).toContain('[global]');

    const q = await run(['search', 'query', 'hello']);
    expect(q.out).toContain('Hello World');

    // default-collection path: no "collection:" prefix
    const added2 = await run(['article', 'create', 'From Default', '-t', 'x']);
    expect(added2.ok).toBe(true);

    expect((await run(['article', 'update', 'notes:hello-world', '-b', '# Hi again'])).ok).toBe(true);
    // update can also overwrite tags (composes setTags); body is optional here
    expect((await run(['article', 'update', 'notes:hello-world', '-t', 'temp'])).ok).toBe(true);
    expect((await run(['tags', 'add', 'notes:hello-world', 'd,e'])).ok).toBe(true);
    expect((await run(['tags', 'remove', 'notes:hello-world', 'a'])).ok).toBe(true);
    const setTags = await run(['tags', 'set', 'notes:hello-world', 'only']);
    expect(setTags.out).toContain('only');

    expect((await run(['article', 'remove', 'notes:hello-world'])).ok).toBe(true);
    await expect(fs.access(articlePath)).rejects.toBeTruthy();
  });

  it('sets audience/status on create and toggles them on update', async () => {
    await run(['collection', 'create', 'notes']);
    const created = await run([
      'article',
      'create',
      'notes:Secret',
      '-b',
      '# Secret',
      '--audience',
      'private',
      '--status',
      'draft',
    ]);
    expect(created.ok).toBe(true);
    const file = created.out.trim();
    let fm = await fs.readFile(file, 'utf8');
    expect(fm).toContain('audience: private');
    expect(fm).toContain('status: draft');

    // Setting audience back to the default (public) drops its frontmatter line; status stays.
    expect((await run(['article', 'update', 'notes:secret', '--audience', 'public'])).ok).toBe(true);
    fm = await fs.readFile(file, 'utf8');
    expect(fm).not.toContain('audience:');
    expect(fm).toContain('status: draft');
    // (invalid --audience/--status values are rejected by Commander's choices() at
    // parse time via process.exit, which the in-process test harness can't trap.)
  });

  it('reports a clean error for a duplicate collection', async () => {
    await run(['collection', 'create', 'dup']);
    const second = await run(['collection', 'create', 'dup']);
    expect(second.ok).toBe(false);
    expect(second.err).toContain('already exists');
  });

  it('reports a clean error when no default collection is set', async () => {
    const res = await run(['article', 'create', 'Orphan', '-t', 'x']);
    expect(res.ok).toBe(false);
    expect(res.err).toContain('no default collection');
  });

  it('removes an article from the default collection without a collection prefix', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);
    await run(['config', 'set', 'defaultCollection', 'notes']);
    const created = await run(['article', 'create', 'Scratch Idea', '-t', 'note']);
    const articlePath = created.out.trim();

    // Act
    const removed = await run(['article', 'remove', 'scratch-idea']);

    // Assert
    expect(removed.ok).toBe(true);
    await expect(fs.access(articlePath)).rejects.toBeTruthy();
  });

  it('fails cleanly when removing without a collection prefix and no defaultCollection is set', async () => {
    // Arrange
    await run(['collection', 'create', 'notes']);
    await run(['article', 'create', 'notes:Scratch Idea', '-t', 'note']);

    // Act
    const removed = await run(['article', 'remove', 'scratch-idea']);

    // Assert
    expect(removed.ok).toBe(false);
    expect(removed.err).toContain('no default collection');
  });
});

describe('given global and repo collections', () => {
  it('deletes the folder, unregisters it, and clears matching defaultCollection when removing an empty or index-only global collection', async () => {
    // Arrange
    await run(['collection', 'create', 'scratch']);
    await run(['config', 'set', 'defaultCollection', 'scratch']);
    const collPath = path.join(home, 'collections', 'scratch');
    await fs.writeFile(path.join(collPath, 'index.md'), '---\ntitle: Scratch\n---\n\n# Scratch\n', 'utf8');

    // Act
    const removed = await run(['collection', 'remove', 'scratch', '--json']);

    // Assert
    expect(removed.ok, removed.err).toBe(true);
    const parsed = JSON.parse(removed.out) as { name: string; type: string };
    expect(parsed.name).toBe('scratch');
    expect(parsed.type).toBe('global');
    await expect(fs.access(collPath)).rejects.toBeTruthy();
    const list = await run(['collection', 'list']);
    expect(list.out).not.toContain('scratch');
    const defaultColl = await run(['config', 'get', 'defaultCollection']);
    expect(defaultColl.out.trim()).toBe('(unset)');
  });

  it('exits non-zero with CollectionNotEmptyError and keeps articles intact when removing a non-empty global collection without --force', async () => {
    // Arrange
    await run(['collection', 'create', 'guides']);
    const created = await run(['article', 'create', 'guides:Setup Guide', '-b', '# Setup', '-t', 'ops']);
    const articlePath = created.out.trim();

    // Act
    const removed = await run(['collection', 'remove', 'guides']);

    // Assert
    expect(removed.ok).toBe(false);
    expect(removed.err).toContain('CollectionNotEmptyError');
    expect(removed.err).toContain('--force');
    await fs.access(articlePath);
    const list = await run(['collection', 'list']);
    expect(list.out).toContain('guides');
  });

  it('deletes the folder and preserves meta/<name> when removing a non-empty global collection with --force', async () => {
    // Arrange
    await run(['collection', 'create', 'guides']);
    await run(['article', 'create', 'guides:Setup Guide', '-b', '# Setup', '-t', 'ops']);
    await run(['meta', 'init', 'guides']);
    const collPath = path.join(home, 'collections', 'guides');
    const metaIndexPath = path.join(home, 'meta', 'guides', '.meta', 'META.md');
    const metaMirrorPath = path.join(home, 'meta', 'guides', 'setup-guide.md');
    await fs.access(metaIndexPath);
    await fs.access(metaMirrorPath);

    // Act
    const removed = await run(['collection', 'remove', 'guides', '--force']);

    // Assert
    expect(removed.ok, removed.err).toBe(true);
    await expect(fs.access(collPath)).rejects.toBeTruthy();
    await fs.access(metaIndexPath);
    await fs.access(metaMirrorPath);
    const list = await run(['collection', 'list']);
    expect(list.out).not.toContain('guides');
  });

  it('unregisters a repo collection without deleting repository files when diffwiki collection remove runs', async () => {
    // Arrange
    const repoDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-repo-rm-')));
    const prevCwd = process.cwd();
    try {
      process.chdir(repoDir);
      await run(['collection', 'init', '-c', 'product-docs', '-p', 'wiki']);
      const created = await run(['article', 'create', 'product-docs:Overview', '-b', '# Overview', '-t', 'doc']);
      const articlePath = created.out.trim();

      // Act
      const removed = await run(['collection', 'remove', 'product-docs']);

      // Assert
      expect(removed.ok, removed.err).toBe(true);
      await fs.access(articlePath);
      const list = await run(['collection', 'list']);
      expect(list.out).not.toContain('product-docs');
    } finally {
      process.chdir(prevCwd);
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });
});
