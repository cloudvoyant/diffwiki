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
});
