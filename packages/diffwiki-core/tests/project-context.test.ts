import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readContextCollections, setContextCollections } from '../src';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-proj-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const read = (d: string) => fs.readFile(path.join(d, 'diffwiki.yaml'), 'utf8');

describe('setContextCollections', () => {
  it('creates diffwiki.yaml with a context block when absent', async () => {
    await setContextCollections(dir, ['a', 'b']);
    expect(await readContextCollections(dir)).toEqual(['a', 'b']);
  });

  it('preserves existing keys and comments when adding context', async () => {
    await fs.writeFile(
      path.join(dir, 'diffwiki.yaml'),
      '# header comment\ncollection: docs\npath: wiki # inline\n',
      'utf8',
    );
    await setContextCollections(dir, ['docs', 'knowledge-base']);
    const out = await read(dir);
    expect(out).toContain('# header comment');
    expect(out).toContain('# inline');
    expect(out).toContain('collection: docs');
    expect(out).toContain('path: wiki');
    expect(await readContextCollections(dir)).toEqual(['docs', 'knowledge-base']);
  });

  it('replaces the list on a subsequent set (round-trips through the reader)', async () => {
    await setContextCollections(dir, ['a', 'b', 'c']);
    await setContextCollections(dir, ['x']);
    expect(await readContextCollections(dir)).toEqual(['x']);
  });

  it('supports an empty list (clears the context)', async () => {
    await setContextCollections(dir, ['a']);
    await setContextCollections(dir, []);
    expect(await readContextCollections(dir)).toEqual([]);
  });
});
