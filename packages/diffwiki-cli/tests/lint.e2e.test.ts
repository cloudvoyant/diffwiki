import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;
let originalCwd: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-')));
  process.env.DIFFWIKI_HOME = home;
  originalCwd = process.cwd();
});
afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

describe('diffwiki lint', () => {
  it('reports errors and exits non-zero for a bad article', async () => {
    await run(['collection', 'create', 'kb']);
    await run(['article', 'create', 'kb:Good', '-b', 'See [ref](https://example.com) for details.']);
    await run(['article', 'create', 'kb:Bad', '-b', 'no links here at all', '--status', 'draft']);
    const res = await run(['lint', '-c', 'kb']);
    expect(res.ok).toBe(false);
    expect(res.out).toContain('References');
    expect(res.out).toContain('draft');
    expect(res.out).toContain('error(s)');
  });
});
