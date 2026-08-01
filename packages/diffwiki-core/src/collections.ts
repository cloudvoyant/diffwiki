import fs from 'node:fs/promises';
import { collectionDir } from './paths';
import { readRegistry, registerCollection, unregisterCollection } from './registry';
import { CollectionExistsError, CollectionNotFoundError } from './errors';
import type { Audience, CollectionEntry, PluginEvent } from './types';

/**
 * Fire a lifecycle hook without a static import edge into the loader graph
 * (avoids a `collections <-> events` cycle). Lazy dynamic import, all swallowed.
 * Callers invoke this fire-and-forget: `void fireHook(...)`.
 */
async function fireHook(event: PluginEvent, collection: string): Promise<void> {
  try {
    const { emitPluginEvent } = await import('./plugins/events');
    await emitPluginEvent(event, collection);
  } catch {
    /* never let a hook failure surface into a mutation */
  }
}

export async function listCollections(): Promise<CollectionEntry[]> {
  return (await readRegistry()).collections;
}

export async function findCollection(name: string): Promise<CollectionEntry | undefined> {
  return (await readRegistry()).collections.find((c) => c.name === name);
}

export async function findCollectionById(id: string): Promise<CollectionEntry | undefined> {
  return (await readRegistry()).collections.find((c) => c.id === id);
}

export async function createCollection(name: string, opts?: { audience?: Audience }): Promise<CollectionEntry> {
  if (await findCollection(name)) throw new CollectionExistsError(name);
  const dir = collectionDir(name);
  await fs.mkdir(dir, { recursive: true });
  const entry: CollectionEntry = {
    name,
    type: 'global',
    path: dir,
    createdAt: new Date().toISOString(),
    ...(opts?.audience ? { audience: opts.audience } : {}),
  };
  await registerCollection(entry);
  void fireHook('collection-added', name);
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
  void fireHook('collection-removed', name);
  return entry;
}
