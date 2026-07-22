/**
 * Plugin loading and search-mode discovery.
 *
 * `loadSearchProvider()` returns a `SearchProvider` backed by one-shot
 * subprocess invocations -- each method call spawns the plugin, sends a
 * single request, and reads the response. There is no persistent process
 * and no `close()` method.
 *
 * `listSearchModes()` reads cached capabilities from the plugin registry
 * rather than spawning each plugin, eliminating the startup cost that the
 * old implementation paid on every web page load.
 *
 * @module
 */

import path from 'node:path';
import { NATIVE_ENGINE } from '../types';
import type {
  CollectionEntry,
  PluginCapabilities,
  PluginHealth,
  PluginReadiness,
  QueryHit,
  SearchMode,
  SearchProvider,
} from '../types';
import { findEnabledPlugin, listEnabledPlugins } from './registry';
import { invokePlugin, SEARCH_TIMEOUT_MS, LONG_TIMEOUT_MS } from './invoke';

/** Wire-format collection sent to the plugin. */
interface WireCollection {
  name: string;
  path: string;
}

/** Wire-format search hit received from the plugin. */
interface WireHit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  score?: number;
  docid?: string;
  tags?: string[];
}

function toWireCollections(collections: CollectionEntry[]): WireCollection[] {
  return collections.map((c) => ({ name: c.name, path: c.path }));
}

/**
 * Map raw wire hits from a plugin response to `QueryHit[]`, resolving
 * relative paths to absolute paths against the collection entries.
 */
function mapHits(result: unknown, collections: CollectionEntry[]): QueryHit[] {
  const raw = (result as { hits?: unknown } | undefined)?.hits;
  const hits = Array.isArray(raw) ? raw : [];
  const out: QueryHit[] = [];
  for (const item of hits) {
    if (typeof item !== 'object' || item === null) continue;
    const h = item as Partial<WireHit>;
    if (typeof h.collection !== 'string' || typeof h.relPath !== 'string') continue;
    const title = typeof h.title === 'string' ? h.title : h.relPath;
    const coll = collections.find((c) => c.name === h.collection);
    const abs = coll ? path.join(coll.path, h.relPath) : h.relPath;
    out.push({
      collection: h.collection,
      path: abs,
      title,
      tags: Array.isArray(h.tags) ? h.tags.filter((t): t is string => typeof t === 'string') : [],
      snippet: typeof h.snippet === 'string' ? h.snippet : undefined,
      score: typeof h.score === 'number' ? h.score : undefined,
      docid: typeof h.docid === 'string' ? h.docid : undefined,
    });
  }
  return out;
}

/**
 * Load a search provider backed by one-shot subprocess invocations.
 *
 * Each method on the returned `SearchProvider` spawns the plugin binary,
 * sends one JSON request, reads the response, and the process exits.
 * Returns `null` if no matching enabled plugin is found or the plugin
 * fails its `describe` handshake.
 *
 * @param name - Optional plugin name. If omitted, the first enabled search plugin is used.
 */
export async function loadSearchProvider(name?: string): Promise<SearchProvider | null> {
  const record = await findEnabledPlugin('search', name);
  if (!record) return null;

  // Validate the plugin can respond to describe.
  let capabilities: PluginCapabilities;
  try {
    const desc = await invokePlugin<{
      name: string;
      kind: string;
      version?: string;
      capabilities: PluginCapabilities;
    }>(record.command, 'describe', {}, { name: record.name });

    if (desc.kind !== 'search') {
      return null;
    }
    capabilities = desc.capabilities;
  } catch {
    return null;
  }

  const provider: SearchProvider = {
    name: record.name,
    capabilities,

    async handleSearch(term, collections, opts) {
      const result = await invokePlugin(
        record.command,
        'search',
        {
          term,
          collections: toWireCollections(collections),
          collection: opts?.collection,
          type: opts?.type,
          limit: opts?.limit,
        },
        { timeoutMs: SEARCH_TIMEOUT_MS, name: record.name },
      );
      return mapHits(result, collections);
    },

    async reindex(collections, opts) {
      const result = await invokePlugin<{ indexed?: number }>(
        record.command,
        'index',
        {
          collections: toWireCollections(collections),
          embed: opts?.embed,
        },
        { timeoutMs: LONG_TIMEOUT_MS, name: record.name },
      );
      return result?.indexed ?? 0;
    },

    async emitEvent(event, collection, relPath, collections) {
      try {
        const entry = collections.find((c) => c.name === collection);
        await invokePlugin(
          record.command,
          'event',
          {
            event,
            collection: entry ? { name: entry.name, path: entry.path } : { name: collection, path: '' },
            relPath,
            collections: toWireCollections(collections),
          },
          { name: record.name },
        );
      } catch {
        // hooks are best-effort -- never surface into a mutation
      }
    },

    async health(collections): Promise<PluginHealth> {
      const result = await invokePlugin<{
        ready?: boolean;
        readiness?: PluginReadiness;
        diagnostics?: PluginHealth['diagnostics'];
      }>(record.command, 'health', { collections: toWireCollections(collections) }, { name: record.name });
      return {
        ready: result?.ready === true,
        readiness: result?.readiness,
        diagnostics: result?.diagnostics ?? [],
      };
    },
  };

  return provider;
}

/**
 * List all available search modes, starting with native BM25.
 *
 * Reads cached capabilities from the plugin registry rather than spawning
 * each plugin. Plugins without cached capabilities (registered before
 * the SDK refactor) are skipped -- re-register to populate them.
 */
export async function listSearchModes(): Promise<SearchMode[]> {
  const modes: SearchMode[] = [{ plugin: NATIVE_ENGINE, type: 'basic', label: 'native · bm25' }];
  const plugins = await listEnabledPlugins('search');
  for (const record of plugins) {
    const caps = record.capabilities;
    if (!caps) continue;
    for (const type of caps.searchTypes) {
      modes.push({ plugin: record.name, type, label: `${record.name} · ${type}` });
    }
  }
  return modes;
}
