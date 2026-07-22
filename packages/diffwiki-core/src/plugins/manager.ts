/**
 * Plugin lifecycle management.
 *
 * Handles installing (from npm), registering (from an existing binary),
 * removing, and listing plugins. Installation and registration both run
 * a `describe` op to validate the plugin and cache its capabilities in
 * the registry, then a best-effort `setup` op to provision the plugin.
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pluginsDir } from '../paths';
import { PluginError } from '../errors';
import { listCollections } from '../collections';
import { deregisterPlugin, readPluginRegistry, upsertPlugin } from './registry';
import { invokePlugin, LONG_TIMEOUT_MS } from './invoke';
import type { PluginCapabilities, PluginRecord } from '../types';
import { runProcess } from '../plugin';

interface PackageManifest {
  name?: string;
  version?: string;
  bin?: string | Record<string, string>;
  diffwiki?: { kind?: string };
}

async function readPackageJson(file: string): Promise<PackageManifest | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/** The first bin entry of a manifest (string form or object form), or null. */
function binOf(manifest: PackageManifest): string | null {
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (manifest.bin && typeof manifest.bin === 'object') {
    const first = Object.values(manifest.bin)[0];
    return typeof first === 'string' ? first : null;
  }
  return null;
}

/** Package dirs under node_modules: top-level and one level of @scope/*. */
async function pluginManifestDirs(nodeModules: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(nodeModules);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      let scoped: string[];
      try {
        scoped = await fs.readdir(path.join(nodeModules, entry));
      } catch {
        continue;
      }
      for (const pkg of scoped) {
        if (pkg.startsWith('.')) continue;
        dirs.push(path.join(nodeModules, entry, pkg));
      }
    } else {
      dirs.push(path.join(nodeModules, entry));
    }
  }
  return dirs;
}

/** Create the managed plugin root (an isolated npm project) and return its path. */
export async function ensurePluginRoot(): Promise<string> {
  const dir = pluginsDir();
  await fs.mkdir(dir, { recursive: true });
  const pkgPath = path.join(dir, 'package.json');
  if ((await readPackageJson(pkgPath)) === null) {
    const pkg = { name: 'diffwiki-plugins', private: true, version: '0.0.0' };
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }
  return dir;
}

interface DiscoveredPackage {
  name: string;
  version?: string;
  binAbs: string;
}

/** Scan the managed node_modules for a `diffwiki.kind === 'search'` package with a bin. */
async function discoverSearchPackage(dir: string): Promise<DiscoveredPackage | null> {
  const nodeModules = path.join(dir, 'node_modules');
  for (const pkgDir of await pluginManifestDirs(nodeModules)) {
    const manifest = await readPackageJson(path.join(pkgDir, 'package.json'));
    if (!manifest?.name || manifest.diffwiki?.kind !== 'search') continue;
    const bin = binOf(manifest);
    if (!bin) continue;
    return { name: manifest.name, version: manifest.version, binAbs: path.resolve(pkgDir, bin) };
  }
  return null;
}

/**
 * Run a one-shot `describe` op to validate the plugin and return its
 * capabilities. `name`, when known, scopes forwarded plugin logs.
 */
async function describePlugin(
  command: string[],
  name?: string,
): Promise<{
  name: string;
  kind: string;
  version?: string;
  capabilities: PluginCapabilities;
}> {
  return invokePlugin<{
    name: string;
    kind: string;
    version?: string;
    capabilities: PluginCapabilities;
  }>(command, 'describe', {}, { name });
}

/** Run a plugin's `setup` op end-to-end, best-effort. `name` scopes forwarded logs. */
async function runSetup(command: string[], name?: string): Promise<void> {
  try {
    const collections = await listCollections();
    await invokePlugin(
      command,
      'setup',
      {
        collections: collections.map((c) => ({ name: c.name, path: c.path })),
        embed: false,
        prefetchModels: false,
      },
      { timeoutMs: LONG_TIMEOUT_MS, name },
    );
  } catch {
    /* setup is best-effort; doctor reports readiness problems later */
  }
}

/**
 * Install an npm spec into the managed root, register the discovered search bin,
 * run a `describe` to validate and cache capabilities, then (unless `opts.setup
 * === false`) run the plugin's `setup` op so the user lands on a working search.
 */
export async function installPlugin(
  spec: string,
  opts?: { setup?: boolean; prefetchModels?: boolean },
): Promise<PluginRecord> {
  const dir = await ensurePluginRoot();
  try {
    await runProcess('npm', ['install', spec, '--prefix', dir]);
  } catch (err) {
    throw new PluginError(`npm install ${spec} failed: ${(err as Error).message}`);
  }
  const discovered = await discoverSearchPackage(dir);
  if (!discovered) {
    throw new PluginError(
      `no diffwiki search plugin found in "${spec}" (need package.json diffwiki.kind === "search" + bin)`,
    );
  }

  const command = ['node', discovered.binAbs];

  // Validate via describe and cache capabilities.
  let capabilities: PluginCapabilities;
  try {
    const desc = await describePlugin(command, discovered.name);
    if (desc.kind !== 'search') {
      throw new PluginError(`plugin "${discovered.name}" reported kind "${desc.kind}", expected "search"`);
    }
    capabilities = desc.capabilities;
  } catch (err) {
    if (err instanceof PluginError) throw err;
    throw new PluginError(`plugin "${discovered.name}" failed describe: ${(err as Error).message}`);
  }

  const record: PluginRecord = {
    name: discovered.name,
    kind: 'search',
    command,
    version: discovered.version,
    capabilities,
    enabled: true,
    managed: true,
  };
  await upsertPlugin(record);

  if (opts?.setup !== false) {
    await runSetup(command, discovered.name);
  }
  return record;
}

/**
 * Register an existing executable as a search plugin. Validates by running
 * `describe`, caches capabilities, then runs `setup` best-effort.
 */
export async function registerPlugin(name: string, command: string[]): Promise<PluginRecord> {
  if (command.length === 0) throw new PluginError(`register "${name}": --command must not be empty`);

  // Validate via describe.
  let capabilities: PluginCapabilities;
  try {
    const desc = await describePlugin(command, name);
    if (desc.kind !== 'search') {
      throw new PluginError(`plugin "${name}" reported kind "${desc.kind}", expected "search"`);
    }
    capabilities = desc.capabilities;
  } catch (err) {
    if (err instanceof PluginError) throw err;
    throw new PluginError(`plugin "${name}" did not respond to describe (command: ${command.join(' ')})`);
  }

  const record: PluginRecord = {
    name,
    kind: 'search',
    command,
    capabilities,
    enabled: true,
    managed: false,
  };
  await upsertPlugin(record);

  await runSetup(command, name);
  return record;
}

/** Uninstall a managed plugin's package and deregister it. */
export async function removePlugin(name: string): Promise<void> {
  const record = (await readPluginRegistry()).plugins.find((p) => p.name === name);
  if (!record) throw new PluginError(`plugin "${name}" is not registered`);
  if (record.managed) {
    const dir = await ensurePluginRoot();
    try {
      await runProcess('npm', ['uninstall', name, '--prefix', dir]);
    } catch {
      /* proceed to deregister even if npm uninstall complains */
    }
  }
  await deregisterPlugin(name);
}

/** Attempt a one-shot `describe` to check if the plugin responds. */
async function probeDescribable(command: string[], name?: string): Promise<boolean> {
  try {
    await describePlugin(command, name);
    return true;
  } catch {
    return false;
  }
}

/** List every registered plugin, marking whether it currently responds to `describe`. */
export async function listPlugins(): Promise<Array<PluginRecord & { spawnable: boolean }>> {
  const registry = await readPluginRegistry();
  const out: Array<PluginRecord & { spawnable: boolean }> = [];
  for (const record of registry.plugins) {
    const spawnable = record.enabled ? await probeDescribable(record.command, record.name) : false;
    out.push({ ...record, spawnable });
  }
  return out;
}
