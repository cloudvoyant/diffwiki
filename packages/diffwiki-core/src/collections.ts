import fs from 'node:fs/promises';
import { collectionDir } from './paths';
import { readRegistry, registerCollection, unregisterCollection } from './registry';
import { CollectionExistsError, CollectionNotFoundError } from './errors';
import type { CollectionEntry } from './types';

export async function listCollections(): Promise<CollectionEntry[]> {
  return (await readRegistry()).collections;
}

export async function findCollection(name: string): Promise<CollectionEntry | undefined> {
  return (await readRegistry()).collections.find((c) => c.name === name);
}

export async function createCollection(name: string): Promise<CollectionEntry> {
  if (await findCollection(name)) throw new CollectionExistsError(name);
  const dir = collectionDir(name);
  await fs.mkdir(dir, { recursive: true });
  const entry: CollectionEntry = {
    name,
    type: 'global',
    path: dir,
    createdAt: new Date().toISOString(),
  };
  await registerCollection(entry);
  return entry;
}

/**
 * Remove a collection from the registry. For `global` collections we own the
 * storage, so its directory is deleted too; for `repo` wikis we only deregister
 * (the files live in the user's repo and are left untouched).
 */
export async function removeCollection(name: string): Promise<CollectionEntry> {
  const entry = await findCollection(name);
  if (!entry) throw new CollectionNotFoundError(name);
  await unregisterCollection(name);
  if (entry.type === 'global') {
    await fs.rm(entry.path, { recursive: true, force: true });
  }
  return entry;
}
