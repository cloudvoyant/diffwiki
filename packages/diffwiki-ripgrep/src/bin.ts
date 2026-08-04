/**
 * diffwiki-ripgrep plugin binary.
 *
 * Implements the diffwiki plugin protocol via `definePlugin()` from the SDK.
 * A single `fuzzy` search mode: `rg` (ripgrep) scans markdown for candidate
 * lines matching any query token, then `fzf --filter` fuzzy-ranks them against
 * the full query. No index, no models. Falls back to plain ripgrep order when
 * fzf isn't installed.
 *
 * @module
 */

import { definePlugin, ensureTool } from 'diffwiki-core/plugin';
import type {
  PluginDefinition,
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
import {
  cheapTitle,
  fuzzyRank,
  fzfOnPath,
  parseRgLine,
  readFileLines,
  rgOnPath,
  runRg,
  spawnFzf,
  spawnRg,
} from './ripgrep.js';
import type { Collection, Hit, Deps } from './types.js';

// Re-export types so existing imports from this module continue to resolve.
export type { Collection, RgLine, Hit, Deps } from './types.js';

const VERSION = '0.4.0';

const RG_INSTALL = 'https://github.com/BurntSushi/ripgrep';
const FZF_INSTALL = 'https://github.com/junegunn/fzf';

function asCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is Collection =>
        !!c && typeof (c as Collection).name === 'string' && typeof (c as Collection).path === 'string',
    )
    .map((c) => ({ name: (c as Collection).name, path: (c as Collection).path }));
}

/** Prefix-match `filePath` against collections (longest first). Returns null if no match. */
export function matchCollection(
  filePath: string,
  collections: Collection[],
): { collection: string; relPath: string } | null {
  const sorted = [...collections].sort((a, b) => b.path.length - a.path.length);
  for (const col of sorted) {
    const prefix = col.path.endsWith('/') ? col.path : col.path + '/';
    if (filePath.startsWith(prefix)) {
      return { collection: col.name, relPath: filePath.slice(prefix.length) };
    }
    if (filePath === col.path) {
      return { collection: col.name, relPath: '' };
    }
  }
  return null;
}

/** Build the plugin definition with injected rg/fzf spawn and file-read functions. */
export function makePluginDefinition(deps: Deps = {}): {
  definition: PluginDefinition;
  handlers: {
    search: (params: SearchParams, log: PluginLogFn) => Promise<SearchHandlerResult>;
    index: (params: IndexParams, log: PluginLogFn) => Promise<IndexHandlerResult>;
    setup: (params: SetupParams, log: PluginLogFn) => Promise<SetupHandlerResult>;
    onEvent: (params: EventParams, log: PluginLogFn) => Promise<EventHandlerResult>;
    health: (params: HealthParams, log: PluginLogFn) => Promise<HealthHandlerResult>;
  };
} {
  const spawnFn = deps.spawnFn ?? spawnRg;
  const fzfFn = deps.fzfFn ?? spawnFzf;
  const readFn = deps.readFn ?? readFileLines;
  const installFn = deps.installFn ?? ensureTool;

  const RG_SPEC = { command: 'rg', mise: 'ripgrep', brew: 'ripgrep', apt: 'ripgrep', manual: RG_INSTALL };
  const FZF_SPEC = { command: 'fzf', mise: 'fzf', brew: 'fzf', apt: 'fzf', manual: FZF_INSTALL };

  const handlers = {
    async search(params: SearchParams): Promise<SearchHandlerResult> {
      const term = params.term ?? '';
      const collections = asCollections(params.collections);
      const collectionFilter =
        typeof params.collection === 'string' && params.collection.length > 0 ? params.collection : null;
      const limit = params.limit && params.limit > 0 ? params.limit : 20;

      let roots: string[];
      let activeCollections: Collection[];
      if (collectionFilter !== null) {
        const found = collections.find((c) => c.name === collectionFilter);
        roots = found ? [found.path] : [];
        activeCollections = found ? [found] : [];
      } else {
        roots = collections.map((c) => c.path);
        activeCollections = collections;
      }

      if (roots.length === 0 || term.trim().length === 0) {
        return { hits: [] };
      }

      // 1. ripgrep for candidate lines (any token, high recall).
      const candidates = await runRg(spawnFn, term, roots, { limit });
      if (candidates.trim().length === 0) {
        return { hits: [] };
      }

      // 2. fzf fuzzy-rank the candidates against the full query. Best-effort:
      //    if fzf is missing (spawn throws) or finds no full match, keep rg's
      //    order so a partial-recall result still surfaces.
      let ranked = candidates;
      let fuzzyRanked = false;
      try {
        const fzfOut = await fuzzyRank(fzfFn, candidates, term);
        if (fzfOut.trim().length > 0) {
          ranked = fzfOut;
          fuzzyRanked = true;
        }
      } catch {
        /* fzf unavailable — fall back to ripgrep order */
      }

      // 3. Map ranked lines → hits, one per file (first = best-ranked).
      const seen = new Set<string>();
      const hits: Hit[] = [];
      for (const line of ranked.split('\n')) {
        if (hits.length >= limit) break;
        const parsed = parseRgLine(line);
        if (!parsed) continue;
        if (seen.has(parsed.path)) continue;
        seen.add(parsed.path);

        const matched = matchCollection(parsed.path, activeCollections);
        if (!matched) continue;

        const title = await cheapTitle(parsed.path, readFn);
        const snippet = parsed.text.trim();
        hits.push({
          collection: matched.collection,
          relPath: matched.relPath,
          title,
          snippet: snippet.length > 0 ? snippet : undefined,
        });
      }

      // Assign a rank-derived score (best = 1, descending) so the UI shows a
      // relevance badge like the other plugins — but only when fzf actually
      // ranked; plain ripgrep order isn't relevance, so leave it score-less.
      if (fuzzyRanked && hits.length > 0) {
        const total = hits.length;
        hits.forEach((hit, i) => {
          hit.score = Number(((total - i) / total).toFixed(3));
        });
      }

      return { hits };
    },

    async index(): Promise<IndexHandlerResult> {
      return { indexed: 0 };
    },

    async setup(_params: SetupParams, log: PluginLogFn): Promise<SetupHandlerResult> {
      const steps: SetupHandlerResult['steps'] = [];

      // rg is required — auto-install via a detected manager (mise/brew); a hard
      // failure if it still can't be resolved.
      const rg = await installFn(RG_SPEC, { install: true, log });
      if (!rg.present) {
        log('error', `ripgrep (rg) unavailable — ${rg.message}`);
        steps.push({ step: 'verify-rg', ok: false, message: rg.message });
        return { ready: false, steps };
      }
      steps.push({ step: 'verify-rg', ok: true, message: rg.installed ? rg.message : undefined });

      // fzf is recommended, not required: without it search degrades to plain
      // ripgrep order, so setup still succeeds but flags a missing/uninstalled fzf.
      const fzf = await installFn(FZF_SPEC, { install: true, log });
      if (fzf.present) {
        steps.push({ step: 'verify-fzf', ok: true, message: fzf.installed ? fzf.message : undefined });
      } else {
        log('warn', `fzf unavailable — fuzzy ranking disabled (plain ripgrep results). ${fzf.message}`);
        steps.push({ step: 'verify-fzf', ok: false, message: fzf.message });
      }
      return { ready: true, steps };
    },

    async onEvent(): Promise<EventHandlerResult> {
      return { accepted: true };
    },

    async health(): Promise<HealthHandlerResult> {
      const rgPresent = await rgOnPath(spawnFn);
      const fzfPresent = rgPresent ? await fzfOnPath(fzfFn) : false;

      const diagnostics: HealthHandlerResult['diagnostics'] = [];
      if (rgPresent) {
        diagnostics.push({ level: 'ok', message: 'ripgrep ready' });
        diagnostics.push(
          fzfPresent
            ? { level: 'ok', message: 'fzf ready — fuzzy ranking enabled' }
            : {
                level: 'warn',
                message: `fzf not found — using plain ripgrep (no fuzzy ranking); install fzf: ${FZF_INSTALL}`,
              },
        );
      } else {
        diagnostics.push({ level: 'error', message: `ripgrep (rg) not found — install it: ${RG_INSTALL}` });
      }

      return {
        ready: rgPresent,
        readiness: {
          toolInstalled: rgPresent,
          modelsPresent: true,
          indexBuilt: true,
          docsIndexed: 0,
          embeddingsPending: 0,
          firstSearchCost: 'instant',
        },
        diagnostics,
      };
    },
  };

  const definition: PluginDefinition = {
    name: 'diffwiki-ripgrep',
    kind: 'search' as const,
    version: VERSION,
    capabilities: {
      searchTypes: ['fuzzy'],
      collectionFilter: true,
      events: false,
    },
    handlers,
  };

  return { definition, handlers };
}

/** Create the defined plugin with optional injected dependencies. */
export function createPlugin(deps?: Deps): ReturnType<typeof definePlugin> {
  const { definition } = makePluginDefinition(deps);
  return definePlugin(definition);
}

// Run when invoked as a binary.
createPlugin().run();
