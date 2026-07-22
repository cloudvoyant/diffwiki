/**
 * Diagnostics and health checks.
 *
 * `doctor()` inspects the diffwiki home directory, registry, collections,
 * config, and every registered plugin to produce a list of human-readable
 * diagnostics at ok/warn/error severity levels.
 *
 * @module
 */

import fs from 'node:fs/promises';
import { registryPath, resolveHome } from './paths';
import { readRegistry } from './registry';
import { readConfig } from './config';
import { listCollections } from './collections';
import { listPlugins } from './plugins/manager';
import { loadSearchProvider } from './plugins/loader';
import { NATIVE_ENGINE } from './types';
import type { Config, Diagnostic, PluginHealth } from './types';

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Run all diagnostics and return the results. */
export async function doctor(): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  const home = resolveHome();

  out.push(
    (await exists(home))
      ? { level: 'ok', message: `home directory present: ${home}` }
      : { level: 'warn', message: `home directory missing (created on first write): ${home}` },
  );

  out.push(
    (await exists(registryPath()))
      ? { level: 'ok', message: `registry present: ${registryPath()}` }
      : { level: 'warn', message: `registry missing: ${registryPath()}` },
  );

  const registry = await readRegistry();
  for (const c of registry.collections) {
    out.push(
      (await exists(c.path))
        ? { level: 'ok', message: `collection "${c.name}" → ${c.path}` }
        : { level: 'error', message: `collection "${c.name}" points to missing path: ${c.path}` },
    );
  }

  const config = await readConfig();
  if (config.defaultCollection) {
    const found = registry.collections.some((c) => c.name === config.defaultCollection);
    out.push(
      found
        ? { level: 'ok', message: `default collection: ${config.defaultCollection}` }
        : {
            level: 'error',
            message: `default collection "${config.defaultCollection}" is not registered`,
          },
    );
  } else {
    out.push({ level: 'warn', message: 'no default collection set' });
  }

  await appendPluginDiagnostics(out, config);

  return out;
}

/** Human summary of a plugin's first-search cost from its readiness block. */
function readinessLine(name: string, health: PluginHealth): Diagnostic {
  const r = health.readiness;
  if (!r) {
    return { level: health.ready ? 'ok' : 'warn', message: `plugin "${name}" ${health.ready ? 'ready' : 'not ready'}` };
  }
  if (r.firstSearchCost === 'model-download') {
    return {
      level: 'warn',
      message: `plugin "${name}": ${r.docsIndexed} doc(s) indexed — first search will download models (~2GB)`,
    };
  }
  if (r.firstSearchCost === 'model-load') {
    return {
      level: 'warn',
      message: `plugin "${name}": ${r.docsIndexed} doc(s) indexed — first search loads models (a few seconds)`,
    };
  }
  return { level: 'ok', message: `plugin "${name}": ${r.docsIndexed} doc(s) indexed — first search is instant` };
}

/** Append per-plugin registration + readiness diagnostics and a defaultSearch check. */
async function appendPluginDiagnostics(out: Diagnostic[], config: Config): Promise<void> {
  let plugins: Array<{
    name: string;
    kind: string;
    command: string[];
    enabled: boolean;
    managed?: boolean;
    spawnable: boolean;
  }> = [];
  try {
    plugins = await listPlugins();
  } catch (err) {
    out.push({ level: 'error', message: `failed to read plugin registry: ${(err as Error).message}` });
    return;
  }

  if (plugins.length === 0) {
    out.push({ level: 'warn', message: 'no search plugins installed — using built-in native search' });
  }

  const collections = await listCollections();
  for (const p of plugins) {
    if (!p.enabled) {
      out.push({ level: 'warn', message: `plugin "${p.name}" registered but disabled` });
      continue;
    }
    if (!p.spawnable) {
      out.push({
        level: 'error',
        message: `plugin "${p.name}" registered but its command is not spawnable: ${p.command.join(' ')}`,
      });
      continue;
    }
    out.push({ level: 'ok', message: `plugin "${p.name}" enabled and spawnable` });
    try {
      const provider = await loadSearchProvider(p.name);
      if (!provider) {
        out.push({ level: 'error', message: `plugin "${p.name}" failed to load for a health check` });
        continue;
      }
      const health = await provider.health(collections);
      for (const d of health.diagnostics) out.push({ level: d.level, message: `${p.name} · ${d.message}` });
      out.push(readinessLine(p.name, health));
    } catch (err) {
      out.push({ level: 'error', message: `plugin "${p.name}" health check failed: ${(err as Error).message}` });
    }
  }

  if (config.defaultSearch) {
    const engine = config.defaultSearch.split(':')[0];
    const known = engine === NATIVE_ENGINE || plugins.some((p) => p.name === engine && p.enabled);
    if (!known) {
      out.push({
        level: 'warn',
        message: `defaultSearch "${config.defaultSearch}" is not installed/enabled — using native`,
      });
    }
  }
}
