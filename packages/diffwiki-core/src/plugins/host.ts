/**
 * Host-side plugin invocation and search-provider loading.
 *
 * `invokePlugin()` spawns a plugin subprocess, writes a single JSON request to
 * stdin (then closes it), reads the JSON response from stdout, and lets the
 * process exit. Progress/diagnostic logs arrive on STDERR as structured
 * `{log:{level,message}}` JSON lines; the host forwards each to a LogTape logger
 * scoped by plugin name and keeps the raw stderr for on-error context.
 *
 * `loadSearchProvider()` returns a `SearchProvider` backed by one-shot
 * invocations — each method call spawns the plugin fresh. `listSearchModes()`
 * reads cached capabilities from the registry rather than spawning each plugin.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import path, { basename } from 'node:path';
import { getLogger } from '../logger';
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

// ---------------------------------------------------------------------------
// invokePlugin
// ---------------------------------------------------------------------------

/**
 * The LogTape Logger method names, keyed by the level a plugin reports. LogTape
 * 2.x names the level `warning`, but its Logger method is `warn`, so both `warn`
 * and `warning` map to `.warn`. Unknown levels map to `info`.
 */
const LEVEL_METHOD = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
} as const satisfies Record<string, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

/** A structured log line a plugin may emit on stderr. */
interface WireLog {
  log?: { level?: unknown; message?: unknown };
}

/** Default timeout for most ops (describe, health, event). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Timeout for search ops (may trigger an incremental re-embed). */
export const SEARCH_TIMEOUT_MS = 120_000;

/** Timeout for long ops (setup, index -- model download + full embed). */
export const LONG_TIMEOUT_MS = 1_800_000;

/** Options for `invokePlugin`. */
export interface InvokeOptions {
  /** Timeout in milliseconds. Defaults to `DEFAULT_TIMEOUT_MS` (30s). */
  timeoutMs?: number;
  /**
   * Plugin name used as the log scope when forwarding the child's `{log}` lines.
   * Defaults to the basename of the spawned binary (`command[1]` or `command[0]`).
   */
  name?: string;
}

interface WireResponse {
  ok: boolean;
  result?: unknown;
  error?: { message?: string };
}

/**
 * Invoke a single operation on a plugin subprocess.
 *
 * Spawns the plugin using `command` (an argv array), writes `{op, params}` as
 * a single JSON line to stdin, closes stdin, then reads one JSON response line
 * from stdout. The process exits after responding.
 *
 * @param command - The argv to spawn (e.g. `['node', '/path/to/bin.js']`).
 * @param op - The operation name (e.g. `'describe'`, `'search'`, `'index'`).
 * @param params - The operation parameters.
 * @param opts - Optional timeout override and log scope (`name`).
 * @returns The `result` field from the plugin's response.
 * @throws If the plugin exits with an error, times out, or returns `ok: false`.
 */
export async function invokePlugin<T = unknown>(
  command: string[],
  op: string,
  params: Record<string, unknown>,
  opts?: InvokeOptions,
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scope = opts?.name ?? basename(command[1] ?? command[0] ?? 'plugin');

  return new Promise<T>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stderrLine = '';
    let settled = false;

    // Forward a single stderr line that is a `{log:{level,message}}` object to a
    // LogTape logger scoped by the plugin name. An unknown/absent level maps to
    // `info`. Non-JSON / non-log lines stay in the accumulated raw stderr.
    const forwardLog = (line: string): void => {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('{')) return;
      let parsed: WireLog;
      try {
        parsed = JSON.parse(trimmedLine) as WireLog;
      } catch {
        return;
      }
      const entry = parsed.log;
      if (!entry || typeof entry.message !== 'string') return;
      const rawLevel = typeof entry.level === 'string' ? entry.level.toLowerCase() : '';
      const method = LEVEL_METHOD[rawLevel as keyof typeof LEVEL_METHOD] ?? 'info';
      getLogger(['plugin', scope])[method](entry.message);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`plugin "${op}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      // Forward each complete line as it arrives; hold the trailing partial line.
      stderrLine += chunk;
      let nl: number;
      while ((nl = stderrLine.indexOf('\n')) !== -1) {
        forwardLog(stderrLine.slice(0, nl));
        stderrLine = stderrLine.slice(nl + 1);
      }
    });

    child.on('error', (err: Error) => {
      settle(() => reject(new Error(`plugin spawn failed: ${err.message}`)));
    });

    child.on('close', (code: number | null) => {
      // Forward any trailing stderr line the child emitted without a newline.
      if (stderrLine.length > 0) {
        forwardLog(stderrLine);
        stderrLine = '';
      }
      settle(() => {
        const trimmed = stdout.trim();
        if (!trimmed) {
          reject(
            new Error(`plugin "${op}" produced no output (exit ${code})${stderr ? ': ' + stderr.slice(0, 500) : ''}`),
          );
          return;
        }

        let response: WireResponse;
        try {
          response = JSON.parse(trimmed) as WireResponse;
        } catch {
          reject(new Error(`plugin "${op}" returned invalid JSON: ${trimmed.slice(0, 200)}`));
          return;
        }

        if (response.ok) {
          resolve(response.result as T);
        } else {
          const message =
            typeof response.error?.message === 'string' ? response.error.message : `plugin "${op}" failed`;
          reject(new Error(message));
        }
      });
    });

    // Write the request and close stdin so the plugin knows input is complete.
    const request = JSON.stringify({ op, params });
    child.stdin.write(request + '\n', (err) => {
      if (err && !settled) {
        settle(() => reject(new Error(`failed to write to plugin stdin: ${err.message}`)));
        return;
      }
      child.stdin.end();
    });
  });
}

// ---------------------------------------------------------------------------
// loadSearchProvider / listSearchModes
// ---------------------------------------------------------------------------

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
  rawChunk?: string;
  cleanedChunk?: string;
  line?: number;
  snippetFromBody?: boolean;
}

function toWireCollections(collections: CollectionEntry[]): WireCollection[] {
  return collections.map((c) => ({ name: c.name, path: c.path }));
}

/**
 * Map raw wire hits from a plugin response to `QueryHit[]`, resolving relative
 * paths to absolute paths against the collection entries.
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
      rawChunk: typeof h.rawChunk === 'string' ? h.rawChunk : undefined,
      cleanedChunk: typeof h.cleanedChunk === 'string' ? h.cleanedChunk : undefined,
      line: typeof h.line === 'number' ? h.line : undefined,
      snippetFromBody: h.snippetFromBody === true ? true : undefined,
    });
  }
  return out;
}

/**
 * Load a search provider backed by one-shot subprocess invocations. Each method
 * on the returned `SearchProvider` spawns the plugin binary, sends one JSON
 * request, and reads the response. Returns `null` if no matching enabled plugin
 * is found or the plugin fails its `describe` handshake.
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
          expansions: opts?.expansions,
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
 * List all available search modes, starting with native BM25. Reads cached
 * capabilities from the plugin registry rather than spawning each plugin.
 * Plugins without cached capabilities (registered before the SDK refactor) are
 * skipped -- re-register to populate them.
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
