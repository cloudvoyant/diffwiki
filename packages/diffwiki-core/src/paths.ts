import os from 'node:os';
import path from 'node:path';

/** Root of all global diffwiki state. Overridable via DIFFWIKI_HOME (used by tests). */
export function resolveHome(): string {
  const override = process.env.DIFFWIKI_HOME;
  return override && override.length > 0 ? override : path.join(os.homedir(), '.diffwiki');
}

export function registryPath(): string {
  return path.join(resolveHome(), 'registry.json');
}

export function configPath(): string {
  return path.join(resolveHome(), 'config.json');
}

export function collectionsDir(): string {
  return path.join(resolveHome(), 'collections');
}

/** Where authoring templates live (user-overridable), seeded by `diffwiki templates init`. */
export function templatesDir(): string {
  return path.join(resolveHome(), 'templates');
}

/** Raw source records and per-article source manifests. */
export function metaDir(): string {
  return path.join(resolveHome(), 'meta');
}

export function collectionDir(name: string): string {
  return path.join(collectionsDir(), name);
}

export function pluginsDir(): string {
  return path.join(resolveHome(), 'plugins');
}

export function pluginsRegistryPath(): string {
  return path.join(resolveHome(), 'plugins.json');
}
