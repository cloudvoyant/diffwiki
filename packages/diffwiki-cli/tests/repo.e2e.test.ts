import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;
let repo: string;
let originalCwd: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-home-'));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-repo-'));
  // Resolve symlinks (important on macOS where /tmp is a symlink to /private/tmp)
  home = await fs.realpath(home);
  repo = await fs.realpath(repo);
  process.env.DIFFWIKI_HOME = home;
  originalCwd = process.cwd();
  process.chdir(repo);
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(repo, { recursive: true, force: true });
});

describe('in-repo wiki', () => {
  it('init writes diffwiki.yaml, registers the wiki, and list shows it', async () => {
    const res = await run(['collection', 'init', '-c', 'repo-wiki', '-p', 'docs/wiki']);
    expect(res.ok).toBe(true);

    const yaml = await fs.readFile(path.join(repo, 'diffwiki.yaml'), 'utf8');
    expect(yaml).toContain('collection: repo-wiki');
    expect(yaml).toContain('path: docs/wiki');
    await fs.access(path.join(repo, 'docs/wiki'));

    const list = await run(['collection', 'list']);
    expect(list.out).toContain('repo-wiki');
    expect(list.out).toContain('[repo]');

    // Articles can be added to the repo wiki via its registered name.
    const added = await run(['article', 'create', 'repo-wiki:First Note', '-b', '# First', '-t', 'seed']);
    expect(added.ok).toBe(true);
    const addedPath = path.resolve(added.out.trim());
    const expectedPrefix = path.resolve(path.join(repo, 'docs/wiki'));
    expect(addedPath.startsWith(expectedPrefix)).toBe(true);
  });
});
