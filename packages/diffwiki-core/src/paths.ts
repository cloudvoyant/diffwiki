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

export function collectionDir(name: string): string {
  return path.join(collectionsDir(), name);
}
