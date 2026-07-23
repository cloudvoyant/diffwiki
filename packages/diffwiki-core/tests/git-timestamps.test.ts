import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileTimestamps } from '../src/git';

let dir: string;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-ts-')));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('fileTimestamps', () => {
  it('falls back to filesystem stat for an untracked file (ISO strings)', async () => {
    const file = path.join(dir, 'note.md');
    await fs.writeFile(file, '# note\n');
    const ts = await fileTimestamps(file);
    expect(typeof ts.updated).toBe('string');
    expect(typeof ts.created).toBe('string');
    // Valid ISO-8601 that parses to a real date.
    expect(Number.isNaN(new Date(ts.updated!).getTime())).toBe(false);
    expect(Number.isNaN(new Date(ts.created!).getTime())).toBe(false);
  });

  it('returns {} for a nonexistent path without throwing', async () => {
    const ts = await fileTimestamps(path.join(dir, 'does-not-exist.md'));
    expect(ts.created).toBeUndefined();
    expect(ts.updated).toBeUndefined();
  });
});
