import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

const exec = promisify(execFile);
const g = (cwd: string, args: string[]) => exec('git', args, { cwd });

let home: string;
let repo: string;
let originalCwd: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-repo-')));
  process.env.DIFFWIKI_HOME = home;
  originalCwd = process.cwd();
  await g(repo, ['init']);
  await g(repo, ['config', 'user.email', 't@t.dev']);
  await g(repo, ['config', 'user.name', 'T']);
  await g(repo, ['commit', '--allow-empty', '-m', 'init']);
  process.chdir(repo);
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(repo, { recursive: true, force: true });
});

describe('diffwiki add (external collection)', () => {
  it('adds the current repo and lists it as [external]', async () => {
    const res = await run(['add']);
    expect(res.ok).toBe(true);
    expect(res.out).toContain('Added');
    const list = await run(['list']);
    expect(list.out).toContain('[external]');
  });

  it('refuses to add the same repo twice', async () => {
    expect((await run(['add'])).ok).toBe(true);
    const again = await run(['add']);
    expect(again.ok).toBe(false);
    expect(again.err).toContain('already added');
  });

  it('refuses a linked worktree', async () => {
    const wt = path.join(await fs.realpath(os.tmpdir()), `dw-wt-${Date.now()}`);
    await g(repo, ['worktree', 'add', wt]);
    process.chdir(wt);
    try {
      const res = await run(['add']);
      expect(res.ok).toBe(false);
      expect(res.err).toContain('worktree');
    } finally {
      process.chdir(repo);
      await g(repo, ['worktree', 'remove', '--force', wt]).catch(() => {});
      await fs.rm(wt, { recursive: true, force: true });
    }
  });
});
