import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pluginsDir } from '../paths';
import { PluginError } from '../errors';
import { listCollections } from '../collections';
import { deregisterPlugin, readPluginRegistry, upsertPlugin } from './registry';
import { loadSearchProvider } from './loader';
import type { PluginRecord, SearchProvider } from '../types';

const run = promisify(execFile);

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

/** Close a provider without letting a close failure escape. */
async function bestEffortClose(provider: SearchProvider | null): Promise<void> {
  try {
    await provider?.close();
  } catch {
    /* swallow */
  }
}

/** Run a plugin's `setup` op end-to-end, best-effort, always closing the provider. */
async function runSetup(name: string, prefetchModels: boolean): Promise<void> {
  let provider: SearchProvider | null = null;
  try {
    provider = await loadSearchProvider(name);
    if (provider) {
      await provider.setup(await listCollections(), { embed: false, prefetchModels });
    }
  } catch {
    /* setup is best-effort; doctor reports readiness problems later */
  } finally {
    await bestEffortClose(provider);
  }
}

/**
 * Install an npm spec into the managed root, register the discovered search bin,
 * then (unless opts.setup === false) run the plugin's end-to-end `setup` so the
 * user lands on a warm, working search. A setup failure does not unwind the
 * install -- the record is saved and `doctor` surfaces the problem later.
 */
export async function installPlugin(
  spec: string,
  opts?: { setup?: boolean; prefetchModels?: boolean },
): Promise<PluginRecord> {
  const dir = await ensurePluginRoot();
  try {
    await run('npm', ['install', spec, '--prefix', dir]);
  } catch (err) {
    throw new PluginError(`npm install ${spec} failed: ${(err as Error).message}`);
  }
  const discovered = await discoverSearchPackage(dir);
  if (!discovered) {
    throw new PluginError(
      `no diffwiki search plugin found in "${spec}" (need package.json diffwiki.kind === "search" + bin)`,
    );
  }
  const record: PluginRecord = {
    name: discovered.name,
    kind: 'search',
    command: ['node', discovered.binAbs],
    version: discovered.version,
    enabled: true,
    managed: true,
  };
  await upsertPlugin(record);
  if (opts?.setup !== false) {
    await runSetup(record.name, !!opts?.prefetchModels);
  }
  return record;
}

/**
 * Register an already-present executable as a search plugin. Validates by spawning
 * it (handshake + capability check) and runs its `setup` best-effort.
 */
export async function registerPlugin(name: string, command: string[]): Promise<PluginRecord> {
  if (command.length === 0) throw new PluginError(`register "${name}": --command must not be empty`);
  const record: PluginRecord = { name, kind: 'search', command, enabled: true, managed: false };
  await upsertPlugin(record);
  const provider = await loadSearchProvider(name);
  if (!provider) {
    await deregisterPlugin(name);
    throw new PluginError(`plugin "${name}" did not spawn as a search plugin (command: ${command.join(' ')})`);
  }
  // kind check already passed during spawnPluginClient handshake
  try {
    await provider.setup(await listCollections(), { embed: false, prefetchModels: false });
  } catch {
    /* setup is best-effort; doctor reports readiness problems later */
  } finally {
    await bestEffortClose(provider);
  }
  return record;
}

/** Uninstall a managed plugin's package and deregister it. */
export async function removePlugin(name: string): Promise<void> {
  const record = (await readPluginRegistry()).plugins.find((p) => p.name === name);
  if (!record) throw new PluginError(`plugin "${name}" is not registered`);
  if (record.managed) {
    const dir = await ensurePluginRoot();
    try {
      await run('npm', ['uninstall', name, '--prefix', dir]);
    } catch {
      /* proceed to deregister even if npm uninstall complains */
    }
  }
  await deregisterPlugin(name);
}

/** Attempt to spawn a plugin and report whether it answered the handshake. */
async function probeSpawnable(name: string): Promise<boolean> {
  let provider: SearchProvider | null = null;
  try {
    provider = await loadSearchProvider(name);
    return provider !== null;
  } catch {
    return false;
  } finally {
    await bestEffortClose(provider);
  }
}

/** List every registered plugin, marking whether it currently spawns + handshakes. */
export async function listPlugins(): Promise<Array<PluginRecord & { spawnable: boolean }>> {
  const registry = await readPluginRegistry();
  const out: Array<PluginRecord & { spawnable: boolean }> = [];
  for (const record of registry.plugins) {
    const spawnable = record.enabled ? await probeSpawnable(record.name) : false;
    out.push({ ...record, spawnable });
  }
  return out;
}
