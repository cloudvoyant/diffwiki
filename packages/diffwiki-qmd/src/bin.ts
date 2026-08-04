/**
 * diffwiki-qmd plugin binary.
 *
 * Implements the diffwiki plugin protocol via `definePlugin()` from the SDK.
 * Drives the `qmd` CLI for keyword, semantic, and hybrid search with automatic
 * on-search staleness detection and incremental reindex.
 *
 * Warm mode (Phase 6): the `search` handler first tries the long-lived
 * `qmd mcp --http --daemon` over MCP HTTP (warm models → fast), and falls back
 * to the cold `qmd <sub> --format json` CLI path on any failure. Warm mode is
 * a pure optimisation, gated off entirely by `DIFFWIKI_QMD_WARM=0`.
 *
 * @module
 */

import { existsSync, readdirSync } from 'node:fs';
import { stat, readdir, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { definePlugin, ensureTool } from 'diffwiki-core/plugin';
import type {
  PluginLogFn,
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
import { modelsDir, qmdEnv, qmdIndexPath, qmdOnPath, resetQmdResolution, resolveQmd, QMD_DEPENDENCY } from './qmd.js';
import {
  collectionAdd,
  collectionRemove,
  contextAdd,
  update as qmdUpdate,
  statusRaw as qmdStatusRaw,
  embed as qmdEmbed,
  searchJson,
  searchStructuredJson,
} from './commands.js';
import { ensureDaemon, mcpBaseUrl, probeHealth } from './daemon.js';
import { mcpSearch } from './mcp.js';
import { rowsToHits, enrichHits } from './snippet.js';
// Re-export the snippet/row helpers and search-subcommand mapping from their new
// homes so existing importers (and tests) that reference them via this module
// keep resolving.
export { rowsToHits, enrichHits, splitQmdPath, bodyPreview } from './snippet.js';
export { searchSubcommand } from './commands.js';
import {
  mirrorDir,
  registeredMarker,
  qmdUri,
  contextText,
  rebuildStrippedMirror,
  syncStrippedContent,
  pruneMirrorFile,
  type ArticleMeta,
} from './stripped.js';
import type { Collection, Hit, StatMtimeFn, QmdStatusInfo, FetchFn, SpawnFn, SearchExpansion } from './types.js';

// Re-export types so existing imports from this module continue to resolve.
export type { Collection, QmdRow, Hit, StatMtimeFn, QmdStatusInfo } from './types.js';
// Re-export daemon types used in makePluginDefinition's public signature.
export type { FetchFn, SpawnFn } from './types.js';

const VERSION = '0.3.0';

/** Default statMtime: real fs.stat, returns 0 on ENOENT/error. */
export const realStatMtime: StatMtimeFn = async (filePath) => {
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

/**
 * Newest mtime (epoch ms) across the qmd index's sqlite files.
 *
 * qmd uses WAL mode: writes land in `.sqlite-wal` while the base `.sqlite` mtime
 * stays frozen — all three files must be checked or the index looks perpetually stale.
 */
export async function qmdIndexMtime(home: string, statMtime: StatMtimeFn): Promise<number> {
  const base = qmdIndexPath(home);
  const mtimes = await Promise.all([statMtime(base), statMtime(`${base}-wal`), statMtime(`${base}-shm`)]);
  return Math.max(...mtimes);
}

/** Parse `qmd status` output (no `--format json` support) — scrapes "Total:" / "Pending:" lines. */
export function parseQmdStatus(text: string): QmdStatusInfo {
  const total = /Total:\s*(\d+)/i.exec(text);
  const pending = /Pending:\s*(\d+)/i.exec(text);
  return {
    docsIndexed: total ? Number(total[1]) : 0,
    embeddingsPending: pending ? Number(pending[1]) : 0,
  };
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

/**
 * Ensure each collection's qmd registration points at its stripped mirror, not
 * the source tree. qmd's `collection add` won't re-point an existing name, so the
 * one-time migration drops the old (source-pointed) registration and re-adds the
 * mirror; a marker file makes it idempotent thereafter.
 */
async function ensureMirrorRegistered(
  env: NodeJS.ProcessEnv,
  home: string,
  collections: Collection[],
  log: PluginLogFn,
): Promise<void> {
  for (const c of collections) {
    const mirror = mirrorDir(home, c.name);
    const marker = registeredMarker(home, c.name);
    const migrated = existsSync(marker);
    if (!migrated) {
      // First activation: drop the old source-pointed registration (if any), re-add the mirror.
      try {
        await collectionRemove(c.name, { env });
      } catch (err) {
        // Tolerate "not found" / "does not exist" — the collection was never
        // registered, so there is nothing to remove. Any other failure (e.g.
        // permissions, corrupt index) is re-thrown so it surfaces rather than
        // being silently swallowed before the collectionAdd call.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not found|does not exist|no such/i.test(msg)) throw err;
      }
    }
    try {
      await collectionAdd(mirror, c.name, { env });
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
    if (!migrated) {
      await mkdir(dirname(marker), { recursive: true });
      await writeFile(marker, 'registered\n', 'utf8');
      log('info', `re-pointed collection ${c.name} at stripped mirror (${mirror})`);
    }
  }
}

/** Attach `Title: … . Tags: …` context to each file (best-effort, per file). */
async function addContextEntries(
  env: NodeJS.ProcessEnv,
  name: string,
  entries: Array<{ relPath: string; meta: ArticleMeta }>,
  log: PluginLogFn,
): Promise<void> {
  for (const { relPath, meta } of entries) {
    const text = contextText(meta);
    if (!text) continue;
    try {
      await contextAdd(qmdUri(name, relPath), text, { env });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('warn', `context add failed for ${name}/${relPath}: ${message}`);
    }
  }
}

/**
 * Full stripped reindex for a deliberate setup/index: rebuild each collection's
 * frontmatter-stripped mirror, re-point qmd at it, run `qmd update`, then attach
 * title/tags context. Caller handles embedding.
 */
async function fullStrippedReindex(
  env: NodeJS.ProcessEnv,
  home: string,
  collections: Collection[],
  log: PluginLogFn,
): Promise<void> {
  const metaByCollection = new Map<string, Array<{ relPath: string; meta: ArticleMeta }>>();
  for (const c of collections) {
    metaByCollection.set(c.name, await rebuildStrippedMirror(c.path, mirrorDir(home, c.name)));
  }
  await ensureMirrorRegistered(env, home, collections, log);
  await qmdUpdate({ env });
  for (const c of collections) {
    await addContextEntries(env, c.name, metaByCollection.get(c.name) ?? [], log);
  }
}

/** True unless `DIFFWIKI_QMD_WARM` is explicitly set to `0`. */
export function warmEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.DIFFWIKI_QMD_WARM !== '0';
}

/** Build the plugin definition, closing over a mutable home and injectable seams. */
export function makePluginDefinition(
  deps: {
    home?: string;
    statMtime?: StatMtimeFn;
    /** Injected fetch for warm mode. Defaults to global fetch. */
    fetchFn?: FetchFn;
    /** Injected spawn for the warm daemon. Defaults to child_process.spawn. */
    spawnFn?: SpawnFn;
    /** Injected auto-installer for the qmd binary. Defaults to core's `ensureTool`. */
    installFn?: typeof ensureTool;
  } = {},
): {
  definition: ReturnType<typeof definePlugin>['definition'];
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
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const spawnFn = deps.spawnFn;
  const installFn = deps.installFn ?? ensureTool;

  /**
   * Best-effort staleness check: run `qmd update` (and `embed` for semantic/hybrid)
   * when md/mdx files are newer than the index.
   *
   * Skipped when the warm daemon is up — a concurrent CLI write can corrupt the
   * FTS index while the daemon holds the DB. User must run `diffwiki index` to refresh.
   */
  async function ensureFresh(collections: Collection[], searchType: string, log: PluginLogFn): Promise<void> {
    try {
      const roots = collections.map((c) => c.path);
      const contentMtime = await newestMdMtime(roots, statMtime);
      if (contentMtime === 0) return;
      const indexMtime = await qmdIndexMtime(home, statMtime);
      if (indexMtime >= contentMtime) return;

      const env = qmdEnv(home);

      // Daemon holds the DB — skip CLI write to avoid FTS corruption.
      if (await probeHealth(mcpBaseUrl(env), fetchFn, 1000)) {
        log('warn', 'qmd daemon is serving the index — skipping on-search update; run `diffwiki index` to refresh');
        return;
      }

      log('info', 'index stale — syncing stripped mirror and running qmd update');
      // Refresh the frontmatter-stripped mirror qmd indexes (only files whose
      // source is newer) before re-indexing, so edits don't reintroduce
      // frontmatter chunks. No-op for collections not yet migrated to a mirror.
      for (const c of collections) {
        await syncStrippedContent(c.path, mirrorDir(home, c.name), statMtime);
      }
      await qmdUpdate({ env });

      if (searchType === 'semantic' || searchType === 'hybrid') {
        try {
          const { embeddingsPending } = parseQmdStatus(await qmdStatusRaw({ env }));
          if (embeddingsPending > 0) {
            log('info', `${embeddingsPending} doc(s) need embedding — running qmd embed`);
            await qmdEmbed({ env });
          }
        } catch {
          // status/embed failure is non-fatal
        }
      }
    } catch {
      // entire freshness check is best-effort
    }
  }

  /** Cold search: shell `qmd <sub> --format json`. Fallback when warm mode is off or fails. */
  async function coldSearch(
    env: NodeJS.ProcessEnv,
    term: string,
    type: string,
    limit: number,
    collection: string | undefined,
    expansions: SearchExpansion[] | undefined,
  ): Promise<Hit[]> {
    // Pre-expanded variants (an upstream LLM did the expansion) go through the
    // structured `qmd query` document; otherwise use the per-type subcommand.
    const rows =
      expansions && expansions.length > 0
        ? await searchStructuredJson(expansions, { limit, collection, intent: term }, { env })
        : await searchJson(type, { term, limit, collection }, { env });
    return rowsToHits(Array.isArray(rows) ? rows : []);
  }

  /** Warm search: ensure daemon is up, query over HTTP. Returns null (→ cold fallback) on any failure. */
  async function warmSearch(
    env: NodeJS.ProcessEnv,
    term: string,
    type: string,
    limit: number,
    collection: string | undefined,
    log: PluginLogFn,
    expansions: SearchExpansion[] | undefined,
  ): Promise<Hit[] | null> {
    try {
      const qmdCommand = (await resolveQmd()) ?? undefined;
      const baseUrl = await ensureDaemon(env, { fetchFn, spawnFn, qmdCommand });
      if (!baseUrl) {
        log('warn', 'qmd warm daemon unavailable — falling back to cold search');
        return null;
      }
      const rows = await mcpSearch(baseUrl, { term, type, collection, limit, minScore: 0, expansions }, fetchFn);
      return rowsToHits(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('warn', `qmd warm search failed (${message}) — falling back to cold search`);
      return null;
    }
  }

  const handlers = {
    async search(params: SearchParams, log: PluginLogFn): Promise<SearchHandlerResult> {
      const env = qmdEnv(home);
      const term = params.term ?? '';
      const type = params.type ?? 'keyword';
      const limit = params.limit && params.limit > 0 ? params.limit : 20;
      const collection = params.collection && params.collection.length > 0 ? params.collection : undefined;

      const collections = asCollections(params.collections);
      const expansions =
        Array.isArray(params.expansions) && params.expansions.length > 0 ? params.expansions : undefined;
      await ensureFresh(collections, type, log);

      let hits: Hit[] | null = null;
      if (warmEnabled(env)) {
        hits = await warmSearch(env, term, type, limit, collection, log, expansions);
      }
      if (hits === null) {
        hits = await coldSearch(env, term, type, limit, collection, expansions);
      }

      // Enrich hits from source: restore the real frontmatter title (qmd only
      // sees the frontmatter-stripped mirror, so its title is the body heading),
      // and fall back to a body preview for hits whose chunk sanitized to
      // nothing (the match was the metadata block).
      await enrichHits(hits, collections);
      return { hits };
    },

    async index(params: IndexParams, log: PluginLogFn): Promise<IndexHandlerResult> {
      const env = qmdEnv(home);
      const collections = asCollections(params.collections);
      await fullStrippedReindex(env, home, collections, log);
      if (params.embed === true) {
        log('info', 'embedding index');
        await qmdEmbed({ env });
      }
      return { indexed: collections.length };
    },

    async setup(params: SetupParams, log: PluginLogFn): Promise<SetupHandlerResult> {
      const env = qmdEnv(home);
      const steps: Array<{ step: string; ok: boolean; message?: string }> = [];
      let installed = await qmdOnPath();
      if (!installed) {
        // Best-effort auto-install (mise's npm backend), then re-resolve. The
        // qmd binary normally rides in as the plugin's npm dependency; this
        // covers a manually-registered plugin or a broken npm install.
        const outcome = await installFn(
          { command: 'qmd', mise: 'npm:@tobilu/qmd', manual: QMD_DEPENDENCY.hint ?? 'npm i -g @tobilu/qmd' },
          { install: true, log },
        );
        resetQmdResolution();
        installed = await qmdOnPath();
        if (!installed) {
          log('error', `qmd not found (npm-local or PATH) — ${outcome.message}`);
          steps.push({ step: 'verify-qmd', ok: false, message: outcome.message });
          return { ready: false, steps };
        }
        steps.push({ step: 'verify-qmd', ok: true, message: outcome.installed ? outcome.message : undefined });
      } else {
        steps.push({ step: 'verify-qmd', ok: true });
      }

      const collections = asCollections(params.collections);
      try {
        await fullStrippedReindex(env, home, collections, log);
        steps.push({
          step: 'add-collections',
          ok: true,
          message: `${collections.length} collection(s), frontmatter-stripped`,
        });
        steps.push({ step: 'index', ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ step: 'index', ok: false, message });
      }

      if (params.embed === true || params.prefetchModels === true) {
        log('info', 'embedding index (may download models on first run)');
        try {
          await qmdEmbed({ env });
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
          const mirror = mirrorDir(home, collection.name);
          if (params.event === 'article-removed' && params.relPath) {
            // Delete the mirror file so the removed article is pruned from
            // qmd's index on the next update, not kept until a full rebuild.
            await pruneMirrorFile(mirror, params.relPath);
          } else {
            // Refresh the stripped mirror for this collection before re-indexing
            // it, so the edited file's frontmatter stays out of the index.
            await syncStrippedContent(collection.path, mirror, statMtime);
          }
          await qmdUpdate({ env }, collection.name);
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
        log('error', 'qmd could not be resolved (npm-local or PATH)');
        diagnostics.push({
          level: 'error',
          message: `qmd not installed — ${QMD_DEPENDENCY.hint}`,
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
        ({ docsIndexed, embeddingsPending } = parseQmdStatus(await qmdStatusRaw({ env })));
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

      // Warm-daemon readiness line: best-effort probe, never starts it.
      if (warmEnabled(env)) {
        const daemonUp = await probeHealth(mcpBaseUrl(env), fetchFn, 1000);
        diagnostics.push({
          level: 'ok',
          message: daemonUp
            ? `qmd warm daemon running at ${mcpBaseUrl(env)} — searches use resident models`
            : 'qmd warm daemon not running — first search will start it (cold fallback meanwhile)',
        });
      } else {
        diagnostics.push({ level: 'ok', message: 'qmd warm daemon disabled (DIFFWIKI_QMD_WARM=0) — cold CLI search' });
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

  const definition = {
    name: 'diffwiki-qmd',
    kind: 'search' as const,
    version: VERSION,
    capabilities: {
      searchTypes: ['keyword', 'semantic', 'hybrid'],
      collectionFilter: true,
      events: true,
    },
    dependencies: [QMD_DEPENDENCY],
    handlers,
  };

  return { definition, handlers };
}

/** Build the plugin. `home` defaults to `process.env.DIFFWIKI_HOME` or `~/.diffwiki`. */
export function createPlugin(deps?: {
  home?: string;
  statMtime?: StatMtimeFn;
  fetchFn?: FetchFn;
  spawnFn?: SpawnFn;
}): ReturnType<typeof definePlugin> {
  const { definition } = makePluginDefinition(deps);
  return definePlugin(definition);
}

// Run when invoked as a binary.
const home = process.env.DIFFWIKI_HOME || join(homedir(), '.diffwiki');
createPlugin({ home }).run();
