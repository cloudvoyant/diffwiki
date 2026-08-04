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
import os from 'node:os';
import path from 'node:path';
import { pluginsDir } from '../paths';
import { PluginError } from '../errors';
import { listCollections } from '../collections';
import { setConfigValue } from '../config';
import { deregisterPlugin, readPluginRegistry, upsertPlugin } from './registry';
import { invokePlugin, LONG_TIMEOUT_MS } from './host';
import type { PluginCapabilities, PluginRecord } from '../types';
import { runProcess } from './sdk';

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

/** Turn a package dir into a search plugin descriptor, or null if it is not one. */
async function asSearchPackage(pkgDir: string): Promise<DiscoveredPackage | null> {
  const manifest = await readPackageJson(path.join(pkgDir, 'package.json'));
  if (!manifest?.name || manifest.diffwiki?.kind !== 'search') return null;
  const bin = binOf(manifest);
  if (!bin) return null;
  return { name: manifest.name, version: manifest.version, binAbs: path.resolve(pkgDir, bin) };
}

/**
 * Resolve the npm package name from an install spec so install can target the
 * package the user actually asked for (not whichever search package it scans
 * first). Handles `name`, `name@version`, `@scope/name[@version]`, and local
 * paths (`.`/`/`/`~`/`file:`, whose name is read from the package's own manifest).
 * Returns null for specs whose name can't be determined statically (e.g. a git or
 * tarball URL), in which case the caller falls back to a node_modules scan.
 */
async function packageNameFromSpec(spec: string): Promise<string | null> {
  const looksLikePath =
    spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~') || spec.startsWith('file:');
  if (looksLikePath) {
    const raw = spec.startsWith('file:') ? spec.slice('file:'.length) : spec;
    const abs = path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
    return (await readPackageJson(path.join(abs, 'package.json')))?.name ?? null;
  }
  if (/^(git\+|git:|https?:|ssh:)/.test(spec)) return null;
  // Registry spec. Scoped `@scope/name[@version]`: the version `@` is the one
  // after the scope. Unscoped `name[@version]`: split on the first `@`.
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1);
    return at === -1 ? spec : spec.slice(0, at);
  }
  const at = spec.indexOf('@');
  return at <= 0 ? spec : spec.slice(0, at);
}

/**
 * Resolve a specific installed package (by name) as a search plugin. This is what
 * lets multiple search plugins coexist in the managed root: install targets the
 * package matching the spec instead of the first `diffwiki.kind === 'search'`
 * package found. Returns null if it is absent, has no bin, or is not a search plugin.
 */
async function resolveSearchPackage(dir: string, name: string): Promise<DiscoveredPackage | null> {
  return asSearchPackage(path.join(dir, 'node_modules', ...name.split('/')));
}

/** Scan the managed node_modules for the first `diffwiki.kind === 'search'` package with a bin. */
async function discoverSearchPackage(dir: string): Promise<DiscoveredPackage | null> {
  const nodeModules = path.join(dir, 'node_modules');
  for (const pkgDir of await pluginManifestDirs(nodeModules)) {
    const found = await asSearchPackage(pkgDir);
    if (found) return found;
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

/** One provisioning step reported by a plugin's `setup` op. */
export interface SetupStep {
  step: string;
  ok: boolean;
  message?: string;
}

/** The captured result of a plugin's `setup` op. */
export interface SetupOutcome {
  /** Whether the plugin provisioned to a ready-to-search state. */
  ready: boolean;
  /** Per-step results (e.g. verify-qmd, add-collections, index). */
  steps: SetupStep[];
}

/** The result of {@link installPlugin}: the registered record + the setup outcome (if setup ran). */
export interface InstallOutcome {
  record: PluginRecord;
  /** The setup result, or undefined when setup was skipped (`opts.setup === false`). */
  setup?: SetupOutcome;
  /** True when this install was made the default search engine (`config.defaultSearch`). */
  defaulted?: boolean;
}

/**
 * Run a plugin's `setup` op end-to-end and capture the outcome. Never throws:
 * a setup failure is returned as `{ ready: false, ... }` so the caller can
 * report it rather than aborting the install (the plugin stays registered and
 * search degrades to native until the dependency is resolved). `name` scopes
 * forwarded logs.
 */
async function runSetup(command: string[], name?: string): Promise<SetupOutcome> {
  try {
    const collections = await listCollections();
    const result = await invokePlugin<{ ready?: boolean; steps?: SetupStep[] }>(
      command,
      'setup',
      {
        collections: collections.map((c) => ({ name: c.name, path: c.path })),
        embed: false,
        prefetchModels: false,
      },
      { timeoutMs: LONG_TIMEOUT_MS, name },
    );
    return { ready: result?.ready === true, steps: result?.steps ?? [] };
  } catch (err) {
    return { ready: false, steps: [{ step: 'setup', ok: false, message: (err as Error).message }] };
  }
}

/**
 * Install an npm spec into the managed root, register the discovered search bin,
 * run a `describe` to validate and cache capabilities, then (unless `opts.setup
 * === false`) run the plugin's `setup` op so the user lands on a working search.
 * Unless `opts.setDefault === false`, the freshly-installed engine becomes the
 * default (`config.defaultSearch`) so search uses it immediately — skipped when
 * setup reported the plugin not-ready, so a broken install can't hijack a working
 * default (it would only degrade to native).
 */
export async function installPlugin(
  spec: string,
  opts?: { setup?: boolean; prefetchModels?: boolean; setDefault?: boolean },
): Promise<InstallOutcome> {
  const dir = await ensurePluginRoot();
  try {
    await runProcess('npm', ['install', spec, '--prefix', dir]);
  } catch (err) {
    throw new PluginError(`npm install ${spec} failed: ${(err as Error).message}`);
  }
  // Target the package the spec installed, so a second `plugin install` registers
  // THAT plugin rather than whichever search package is scanned first (which would
  // otherwise make it impossible to install more than one search plugin). Only fall
  // back to a first-match scan for specs whose name can't be resolved statically.
  const installedName = await packageNameFromSpec(spec);
  const discovered = installedName ? await resolveSearchPackage(dir, installedName) : await discoverSearchPackage(dir);
  if (!discovered) {
    throw new PluginError(
      installedName
        ? `"${installedName}" (from "${spec}") is not a diffwiki search plugin (need package.json diffwiki.kind === "search" + a bin)`
        : `no diffwiki search plugin found in "${spec}" (need package.json diffwiki.kind === "search" + bin)`,
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

  const setup = opts?.setup !== false ? await runSetup(command, discovered.name) : undefined;

  // Make the freshly-installed engine the default so search uses it immediately.
  // Skip when setup reported not-ready: a plugin that would only degrade to native
  // shouldn't displace a working default.
  let defaulted = false;
  if (opts?.setDefault !== false && (!setup || setup.ready)) {
    await setConfigValue('defaultSearch', discovered.name);
    defaulted = true;
  }
  return { record, setup, defaulted };
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

/**
 * Best-effort repair: re-run each enabled search plugin's `setup` op, which
 * (re)installs missing system tools (via the plugin's auto-installer) and
 * re-provisions the plugin. Returns per-plugin setup outcomes. Powers
 * `diffwiki doctor --fix`.
 */
export async function repairPlugins(): Promise<Array<{ name: string; setup: SetupOutcome }>> {
  const enabled = (await readPluginRegistry()).plugins.filter((p) => p.enabled && p.kind === 'search');
  const out: Array<{ name: string; setup: SetupOutcome }> = [];
  for (const p of enabled) {
    out.push({ name: p.name, setup: await runSetup(p.command, p.name) });
  }
  return out;
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
