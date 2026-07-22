/**
 * diffwiki-qmd plugin binary.
 *
 * Implements the diffwiki plugin protocol via `definePlugin()` from the SDK.
 * Drives the `qmd` CLI for keyword, semantic, and hybrid search with automatic
 * on-search staleness detection and incremental reindex.
 *
 * @module
 */

import { existsSync, readdirSync } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { definePlugin } from 'diffwiki-core/plugin';
import type {
  PluginLogFn,
  PluginDefinition,
  SearchParams,
  IndexParams,
  SetupParams,
  EventParams,
  HealthParams,
  SearchHandlerResult,
  IndexHandlerResult,
  SetupHandlerResult,
  EventHandlerResult,
  HealthHandlerResult,
} from 'diffwiki-core/plugin';
import { INDEX, modelsDir, qmdEnv, qmdIndexPath, qmdOnPath, runQmd, runQmdJson } from './qmd.js';

const VERSION = '0.3.0';

export interface Collection {
  name: string;
  path: string;
}

export interface QmdRow {
  file?: string;
  displayPath?: string;
  title?: string;
  bestChunk?: string;
  score?: number;
  docid?: string;
}

export interface Hit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  score?: number;
  docid?: string;
}

/** Returns the mtime (epoch ms) for a given path, or 0 if the file does not exist. */
export type StatMtimeFn = (filePath: string) => Promise<number>;

/** Default statMtime: real fs.stat, returns 0 on ENOENT/error. */
export const realStatMtime: StatMtimeFn = async (filePath: string): Promise<number> => {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * Recursively find the newest mtime (epoch ms) among `*.md` / `*.mdx` files
 * under `dirs`. Returns 0 if no markdown files are found or all stats fail.
 */
export async function newestMdMtime(dirs: string[], statFn: StatMtimeFn): Promise<number> {
  let newest = 0;
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
        const mt = await statFn(full);
        if (mt > newest) newest = mt;
      }
    }
  }
  for (const d of dirs) {
    await walk(d);
  }
  return newest;
}

export interface QmdStatusInfo {
  docsIndexed: number;
  embeddingsPending: number;
}

/**
 * Parse the human output of `qmd status` -- it does NOT honour `--format json`,
 * so we scrape the "Total: N files indexed" / "Pending: N need embedding" lines.
 */
export function parseQmdStatus(text: string): QmdStatusInfo {
  const total = /Total:\s*(\d+)/i.exec(text);
  const pending = /Pending:\s*(\d+)/i.exec(text);
  return {
    docsIndexed: total ? Number(total[1]) : 0,
    embeddingsPending: pending ? Number(pending[1]) : 0,
  };
}

/** Derive collection + relPath from a qmd row's `file` (strip `qmd://`) or `displayPath`. */
export function splitQmdPath(row: QmdRow): { collection: string; relPath: string } {
  let raw = '';
  if (typeof row.file === 'string' && row.file.length > 0) {
    raw = row.file.replace(/^qmd:\/\//, '');
  } else if (typeof row.displayPath === 'string') {
    raw = row.displayPath;
  }
  // qmd appends a `?index=<name>` query (and may add a `#fragment`) to the URI
  // when a named index is used -- strip it so the relPath is a clean file path.
  raw = raw.replace(/[?#].*$/, '');
  raw = raw.replace(/^\/+/, '');
  const slash = raw.indexOf('/');
  if (slash === -1) return { collection: raw, relPath: '' };
  return { collection: raw.slice(0, slash), relPath: raw.slice(slash + 1) };
}

/** Map a diffwiki search type to the qmd subcommand. */
export function searchSubcommand(type: string | undefined): string {
  switch (type) {
    case 'semantic':
      return 'vsearch';
    case 'hybrid':
      return 'query';
    case 'keyword':
    default:
      return 'search';
  }
}

function isAlreadyExists(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists/i.test(msg);
}

function asCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is Collection =>
        !!c && typeof (c as Collection).name === 'string' && typeof (c as Collection).path === 'string',
    )
    .map((c) => ({ name: (c as Collection).name, path: (c as Collection).path }));
}

async function addCollections(env: NodeJS.ProcessEnv, collections: Collection[], log: PluginLogFn): Promise<void> {
  for (const c of collections) {
    try {
      await runQmd(['collection', 'add', c.path, '--name', c.name, '--index', INDEX], { env });
      log('info', `added collection ${c.name} (${c.path})`);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      log('info', `collection ${c.name} already present`);
    }
  }
}

/** Build the plugin definition, closing over a mutable home and injectable stat function. */
export function makePluginDefinition(deps: { home?: string; statMtime?: StatMtimeFn } = {}): {
  definition: PluginDefinition;
  handlers: {
    search: (params: SearchParams, log: PluginLogFn) => Promise<SearchHandlerResult>;
    index: (params: IndexParams, log: PluginLogFn) => Promise<IndexHandlerResult>;
    setup: (params: SetupParams, log: PluginLogFn) => Promise<SetupHandlerResult>;
    onEvent: (params: EventParams, log: PluginLogFn) => Promise<EventHandlerResult>;
    health: (params: HealthParams, log: PluginLogFn) => Promise<HealthHandlerResult>;
  };
} {
  const home = deps.home ?? join(homedir(), '.diffwiki');
  const statMtime = deps.statMtime ?? realStatMtime;

  /**
   * Best-effort staleness check: if the newest md/mdx file is newer than the
   * qmd index, run `qmd update` before searching. For semantic/hybrid, also
   * run `qmd embed` when pending.
   */
  async function ensureFresh(collections: Collection[], searchType: string, log: PluginLogFn): Promise<void> {
    try {
      const roots = collections.map((c) => c.path);
      const contentMtime = await newestMdMtime(roots, statMtime);
      if (contentMtime === 0) return;
      const indexMtime = await statMtime(qmdIndexPath(home));
      if (indexMtime >= contentMtime) return;

      const env = qmdEnv(home);
      log('info', 'index stale — running qmd update');
      await runQmd(['update', '--index', INDEX], { env });

      if (searchType === 'semantic' || searchType === 'hybrid') {
        try {
          const { embeddingsPending } = parseQmdStatus(await runQmd(['status', '--index', INDEX], { env }));
          if (embeddingsPending > 0) {
            log('info', `${embeddingsPending} doc(s) need embedding — running qmd embed`);
            await runQmd(['embed', '--index', INDEX], { env });
          }
        } catch {
          // status/embed failure is non-fatal
        }
      }
    } catch {
      // entire freshness check is best-effort
    }
  }

  const handlers = {
    async search(params: SearchParams, log: PluginLogFn): Promise<SearchHandlerResult> {
      const env = qmdEnv(home);
      const term = params.term ?? '';
      const type = params.type ?? 'keyword';
      const limit = params.limit && params.limit > 0 ? params.limit : 20;
      const sub = searchSubcommand(type);

      const collections = asCollections(params.collections);
      await ensureFresh(collections, type, log);

      const args = [sub, '--index', INDEX, '--format', 'json', '-n', String(limit)];
      if (params.collection && params.collection.length > 0) {
        args.push('-c', params.collection);
      }
      args.push('--', term);

      const rows = await runQmdJson<QmdRow[]>(args, { env });
      const hits: Hit[] = (Array.isArray(rows) ? rows : []).map((row) => {
        const { collection, relPath } = splitQmdPath(row);
        return {
          collection,
          relPath,
          title: typeof row.title === 'string' ? row.title : relPath,
          snippet: row.bestChunk || undefined,
          score: typeof row.score === 'number' ? row.score : undefined,
          docid: typeof row.docid === 'string' ? row.docid : undefined,
        };
      });
      return { hits };
    },

    async index(params: IndexParams, log: PluginLogFn): Promise<IndexHandlerResult> {
      const env = qmdEnv(home);
      const collections = asCollections(params.collections);
      await addCollections(env, collections, log);
      await runQmd(['update', '--index', INDEX], { env });
      if (params.embed === true) {
        log('info', 'embedding index');
        await runQmd(['embed', '--index', INDEX], { env });
      }
      return { indexed: collections.length };
    },

    async setup(params: SetupParams, log: PluginLogFn): Promise<SetupHandlerResult> {
      const env = qmdEnv(home);
      const steps: Array<{ step: string; ok: boolean; message?: string }> = [];
      const installed = await qmdOnPath();
      if (!installed) {
        log('error', 'qmd not found on PATH — install with: npm i -g @tobilu/qmd');
        steps.push({ step: 'verify-qmd', ok: false, message: 'qmd not on PATH' });
        return { ready: false, steps };
      }
      steps.push({ step: 'verify-qmd', ok: true });

      const collections = asCollections(params.collections);
      await addCollections(env, collections, log);
      steps.push({
        step: 'add-collections',
        ok: true,
        message: `${collections.length} collection(s)`,
      });

      try {
        await runQmd(['update', '--index', INDEX], { env });
        steps.push({ step: 'index', ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ step: 'index', ok: false, message });
      }

      if (params.embed === true || params.prefetchModels === true) {
        log('info', 'embedding index (may download models on first run)');
        try {
          await runQmd(['embed', '--index', INDEX], { env });
          steps.push({ step: 'embed', ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          steps.push({ step: 'embed', ok: false, message });
        }
      }

      return { ready: true, steps };
    },

    async onEvent(params: EventParams, log: PluginLogFn): Promise<EventHandlerResult> {
      const env = qmdEnv(home);
      const collection = params.collection;
      if (collection && typeof collection.name === 'string' && typeof collection.path === 'string') {
        try {
          await runQmd(['update', '--index', INDEX, '-c', collection.name], { env });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('warn', `event update failed for ${collection.name}: ${message}`);
        }
      }
      return { accepted: true };
    },

    async health(_params: HealthParams, log: PluginLogFn): Promise<HealthHandlerResult> {
      const env = qmdEnv(home);
      const diagnostics: Array<{ level: 'ok' | 'warn' | 'error'; message: string }> = [];
      const toolInstalled = await qmdOnPath();
      if (!toolInstalled) {
        log('error', 'qmd not on PATH');
        diagnostics.push({
          level: 'error',
          message: 'qmd not installed — run: npm i -g @tobilu/qmd',
        });
        return {
          ready: false,
          readiness: {
            toolInstalled: false,
            modelsPresent: false,
            indexBuilt: false,
            docsIndexed: 0,
            embeddingsPending: 0,
            firstSearchCost: 'model-download' as const,
          },
          diagnostics,
        };
      }

      let modelsPresent = false;
      try {
        const dir = modelsDir(home);
        modelsPresent = existsSync(dir) && readdirSync(dir).length > 0;
      } catch {
        modelsPresent = false;
      }

      let docsIndexed = 0;
      let embeddingsPending = 0;
      try {
        ({ docsIndexed, embeddingsPending } = parseQmdStatus(await runQmd(['status', '--index', INDEX], { env })));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        diagnostics.push({ level: 'warn', message: `qmd status unavailable: ${message}` });
      }

      const indexBuilt = docsIndexed > 0;

      const firstSearchCost: 'instant' | 'model-load' | 'model-download' = indexBuilt
        ? 'instant'
        : modelsPresent
          ? 'model-load'
          : 'model-download';

      diagnostics.push({
        level: 'ok',
        message: `qmd ready — ${docsIndexed} docs indexed, ${embeddingsPending} pending embeddings`,
      });
      if (!modelsPresent) {
        diagnostics.push({
          level: 'warn',
          message: 'semantic/hybrid search will download models (~2GB) on first use — run: diffwiki index --embed',
        });
      }

      return {
        ready: indexBuilt || toolInstalled,
        readiness: {
          toolInstalled,
          modelsPresent,
          indexBuilt,
          docsIndexed,
          embeddingsPending,
          firstSearchCost,
        },
        diagnostics,
      };
    },
  };

  const definition: PluginDefinition = {
    name: 'diffwiki-qmd',
    kind: 'search' as const,
    version: VERSION,
    capabilities: {
      searchTypes: ['keyword', 'semantic', 'hybrid'],
      collectionFilter: true,
      events: true,
    },
    handlers,
  };

  return { definition, handlers };
}

/**
 * Create the defined plugin instance. Used by the binary entry point and tests.
 *
 * @param deps - Optional overrides for home directory and stat function.
 * @returns A `DefinedPlugin` whose `.run()` method serves one request.
 */
export function createPlugin(deps?: { home?: string; statMtime?: StatMtimeFn }): ReturnType<typeof definePlugin> {
  const { definition } = makePluginDefinition(deps);
  return definePlugin(definition);
}

// Run when invoked as a binary.
const home = process.env.DIFFWIKI_HOME || join(homedir(), '.diffwiki');
createPlugin({ home }).run();
