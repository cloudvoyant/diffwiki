import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getConfigValue,
  setConfigValue,
  readConfig,
  resolveHome,
  createCollection,
  registerCollection,
  unregisterCollection,
  findCollection,
  listCollections,
  readRegistry,
} from '../src/index';
import type { CollectionEntry } from '../src/index';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-'));
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  await fs.rm(home, { recursive: true, force: true });
});

const entry = (name: string): CollectionEntry => ({
  name,
  type: 'global',
  path: path.join(home, 'collections', name),
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('paths', () => {
  it('resolves home from DIFFWIKI_HOME', () => {
    expect(resolveHome()).toBe(home);
  });
});

describe('config', () => {
  it('returns {} when no config file exists', async () => {
    expect(await readConfig()).toEqual({});
  });

  it('round-trips a value', async () => {
    await createCollection('notes');
    await setConfigValue('defaultCollection', 'notes');
    expect(await getConfigValue('defaultCollection')).toBe('notes');
    expect(await readConfig()).toEqual({ defaultCollection: 'notes' });
  });

  it('returns undefined for an unset key', async () => {
    expect(await getConfigValue('missing')).toBeUndefined();
  });
});

describe('registry', () => {
  it('starts empty', async () => {
    expect(await readRegistry()).toEqual({ version: 1, collections: [] });
    expect(await listCollections()).toEqual([]);
  });

  it('registers, finds, replaces, and unregisters', async () => {
    await registerCollection(entry('a'));
    await registerCollection(entry('b'));
    expect((await listCollections()).map((c) => c.name).sort()).toEqual(['a', 'b']);

    const replaced = { ...entry('a'), path: '/somewhere/else' };
    await registerCollection(replaced);
    expect((await findCollection('a'))?.path).toBe('/somewhere/else');
    expect(await listCollections()).toHaveLength(2);

    await unregisterCollection('a');
    expect(await findCollection('a')).toBeUndefined();
    expect(await listCollections()).toHaveLength(1);
  });
});
