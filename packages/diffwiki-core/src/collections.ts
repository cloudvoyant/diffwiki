import fs from 'node:fs/promises';
import path from 'node:path';
import { clearConfigValue, readConfig } from './config';
import { collectionDir } from './paths';
import { readRegistry, registerCollection, unregisterCollection } from './registry';
import { CollectionExistsError, CollectionNotEmptyError, CollectionNotFoundError } from './errors';
import type { Audience, CollectionEntry, PluginEvent } from './types';

// types -----------------------------------------------------------------------

export interface RemoveCollectionOptions {
  /** Reject removing a global collection when leaf articles remain (default: false). */
  requireEmpty?: boolean;
}

// api -------------------------------------------------------------------------

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
 * storage, so its directory is deleted too; for `repo` and `external` wikis we
 * only deregister (the files live in the user's repo and are left untouched).
 */
export async function removeCollection(name: string, opts?: RemoveCollectionOptions): Promise<CollectionEntry> {
  const entry = await findCollection(name);
  if (!entry) throw new CollectionNotFoundError(name);
  if (entry.type === 'global' && opts?.requireEmpty) {
    const leafCount = await countLeafMarkdownFiles(entry.path);
    if (leafCount > 0) {
      throw new CollectionNotEmptyError(name, leafCount);
    }
  }
  await unregisterCollection(name);
  if (entry.type === 'global') {
    await fs.rm(entry.path, { recursive: true, force: true });
  }
  const config = await readConfig();
  if (config.defaultCollection === name) {
    await clearConfigValue('defaultCollection');
  }
  void fireHook('collection-removed', name);
  return entry;
}

// helpers ---------------------------------------------------------------------

/**
 * Count markdown files inside a collection root excluding a top-level
 * `index.md`/`index.mdx` or `README.md`/`README.mdx` collection landing page.
 */
async function countLeafMarkdownFiles(rootDir: string, currentDir = rootDir): Promise<number> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    throw err;
  }
  let count = 0;
  const isRoot = path.resolve(currentDir) === path.resolve(rootDir);
  for (const item of entries) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(currentDir, item.name);
    if (item.isDirectory()) {
      count += await countLeafMarkdownFiles(rootDir, full);
    } else if (item.isFile() && /\.mdx?$/i.test(item.name)) {
      if (isRoot && /^(index|readme)\.mdx?$/i.test(item.name)) continue;
      count += 1;
    }
  }
  return count;
}

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
