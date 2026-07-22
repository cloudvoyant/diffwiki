/**
 * Plugin registry persistence.
 *
 * Manages the `~/.diffwiki/plugins.json` file that stores plugin records.
 * Each record includes the plugin's name, kind, command argv, version,
 * cached capabilities (populated at install/register time via `describe`),
 * and enabled/managed flags.
 *
 * @module
 */

import fs from 'node:fs/promises';
import { pluginsRegistryPath, resolveHome } from '../paths';
import type { PluginKind, PluginRecord, PluginRegistryFile } from '../types';

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Read the plugin registry from disk. Returns an empty registry if the file does not exist. */
export async function readPluginRegistry(): Promise<PluginRegistryFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(pluginsRegistryPath(), 'utf8')) as Partial<PluginRegistryFile>;
    return { version: parsed.version ?? 1, plugins: parsed.plugins ?? [] };
  } catch (err) {
    if (isMissing(err)) return { version: 1, plugins: [] };
    throw err;
  }
}

/** Write the plugin registry to disk, creating the home directory if needed. */
export async function writePluginRegistry(registry: PluginRegistryFile): Promise<void> {
  await fs.mkdir(resolveHome(), { recursive: true });
  await fs.writeFile(pluginsRegistryPath(), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

/** Insert or replace the plugin record with the same name. */
export async function upsertPlugin(record: PluginRecord): Promise<void> {
  const registry = await readPluginRegistry();
  const index = registry.plugins.findIndex((p) => p.name === record.name);
  if (index >= 0) {
    registry.plugins[index] = record;
  } else {
    registry.plugins.push(record);
  }
  await writePluginRegistry(registry);
}

/** Remove a plugin record by name. */
export async function deregisterPlugin(name: string): Promise<void> {
  const registry = await readPluginRegistry();
  registry.plugins = registry.plugins.filter((p) => p.name !== name);
  await writePluginRegistry(registry);
}

/** List all enabled plugins of a given kind. */
export async function listEnabledPlugins(kind: PluginKind): Promise<PluginRecord[]> {
  const registry = await readPluginRegistry();
  return registry.plugins.filter((p) => p.enabled && p.kind === kind);
}

/** Find a single enabled plugin by kind and optionally by name. Returns the first if name is omitted. */
export async function findEnabledPlugin(kind: PluginKind, name?: string): Promise<PluginRecord | undefined> {
  const enabled = await listEnabledPlugins(kind);
  if (name) return enabled.find((p) => p.name === name);
  return enabled[0];
}

/** Find a plugin record by name (regardless of enabled state). */
export async function findPluginRecord(name: string): Promise<PluginRecord | undefined> {
  const registry = await readPluginRegistry();
  return registry.plugins.find((p) => p.name === name);
}
