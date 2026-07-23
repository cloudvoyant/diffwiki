import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addExternalCollection,
  buildSearchIndex,
  collectionGitStatus,
  findCollectionById,
  isLinkedWorktree,
  repoId,
  resolveCwdCollection,
  WorktreeNotAllowedError,
  CollectionAlreadyAddedError,
} from '../src/index';

const exec = promisify(execFile);
const g = (cwd: string, args: string[]) => exec('git', args, { cwd });

let home: string;
let repo: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-repo-')));
  process.env.DIFFWIKI_HOME = home;
  await g(repo, ['init']);
  await g(repo, ['config', 'user.email', 't@t.dev']);
  await g(repo, ['config', 'user.name', 'T']);
  await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
  await fs.writeFile(path.join(repo, 'docs', 'intro.md'), '---\ntitle: Intro\n---\n# Intro\n');
  await g(repo, ['add', '.']);
  await g(repo, ['commit', '-m', 'init']);
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(repo, { recursive: true, force: true });
});

describe('addExternalCollection', () => {
  it('registers an external collection pointing at docs/, unique by repo id', async () => {
    const entry = await addExternalCollection({ cwd: repo });
    expect(entry.type).toBe('external');
    expect(entry.path).toBe(path.join(repo, 'docs'));
    expect(entry.repoRoot).toBe(repo);
    expect(entry.id).toBeDefined();
    expect(await findCollectionById(entry.id!)).toMatchObject({ name: entry.name });

    // Search index sees the docs article.
    const idx = await buildSearchIndex();
    expect(idx.some((d) => d.slug === 'intro' && d.collection === entry.name)).toBe(true);
  });

  it('refuses to add the same repo twice', async () => {
    await addExternalCollection({ cwd: repo });
    await expect(addExternalCollection({ cwd: repo })).rejects.toBeInstanceOf(CollectionAlreadyAddedError);
  });

  it('auto-inits a non-git directory', async () => {
    const plain = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-plain-')));
    try {
      const entry = await addExternalCollection({ cwd: plain });
      expect(entry.type).toBe('external');
      await fs.access(path.join(plain, '.git'));
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });

  it('refuses linked worktrees', async () => {
    const wt = path.join(await fs.realpath(os.tmpdir()), `dw-wt-${Date.now()}`);
    await g(repo, ['worktree', 'add', wt]);
    try {
      expect(await isLinkedWorktree(wt)).toBe(true);
      await expect(addExternalCollection({ cwd: wt })).rejects.toBeInstanceOf(WorktreeNotAllowedError);
    } finally {
      await g(repo, ['worktree', 'remove', '--force', wt]).catch(() => {});
      await fs.rm(wt, { recursive: true, force: true });
    }
  });

  it('resolves the cwd collection by repo id and reports git status', async () => {
    const entry = await addExternalCollection({ cwd: repo });
    const resolved = await resolveCwdCollection(path.join(repo, 'docs'));
    expect(resolved?.name).toBe(entry.name);
    const status = await collectionGitStatus(entry);
    expect(status).toBeDefined();
    expect(status!.branch).toBeTruthy();
  });
});

describe('repoId', () => {
  it('is stable for the same repo', async () => {
    expect(await repoId(repo)).toBe(await repoId(repo));
  });
});
