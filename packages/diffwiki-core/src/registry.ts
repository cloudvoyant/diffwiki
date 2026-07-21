import fs from 'node:fs/promises';
import { registryPath, resolveHome } from './paths';
import type { CollectionEntry, Registry } from './types';

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export async function readRegistry(): Promise<Registry> {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath(), 'utf8')) as Partial<Registry>;
    return { version: parsed.version ?? 1, collections: parsed.collections ?? [] };
  } catch (err) {
    if (isMissing(err)) return { version: 1, collections: [] };
    throw err;
  }
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await fs.mkdir(resolveHome(), { recursive: true });
  await fs.writeFile(registryPath(), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

/** Insert or replace the entry with the same name. */
export async function registerCollection(entry: CollectionEntry): Promise<void> {
  const registry = await readRegistry();
  const index = registry.collections.findIndex((c) => c.name === entry.name);
  if (index >= 0) {
    registry.collections[index] = entry;
  } else {
    registry.collections.push(entry);
  }
  await writeRegistry(registry);
}

export async function unregisterCollection(name: string): Promise<void> {
  const registry = await readRegistry();
  registry.collections = registry.collections.filter((c) => c.name !== name);
  await writeRegistry(registry);
}
