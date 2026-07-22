/**
 * diffwiki-ripgrep plugin binary.
 *
 * Implements the diffwiki plugin protocol via `definePlugin()` from the SDK.
 * Drives `rg` (ripgrep) for instant literal/regex search -- no index, no
 * models, no setup beyond verifying rg is on PATH.
 *
 * @module
 */

import { definePlugin } from 'diffwiki-core/plugin';
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
import { cheapTitle, readFileLines, rgOnPath, runRg, spawnRg, type ReadFileFn, type SpawnRgFn } from './ripgrep.js';

const VERSION = '0.3.0';

export interface Collection {
  name: string;
  path: string;
}

/** A single parsed rg --json match event (the `data` sub-object). */
export interface RgMatchData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
}

/** A top-level rg --json event line. */
export interface RgEvent {
  type: string;
  data: RgMatchData;
}

export interface Hit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
}

export interface Deps {
  spawnFn?: SpawnRgFn;
  readFn?: ReadFileFn;
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
 * Prefix-match `filePath` against the collection list (longest path first) to
 * derive `{collection, relPath}`. Returns null if no collection matches.
 */
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

/** Parse rg --json stdout into an array of match events. */
export function parseRgOutput(stdout: string): RgEvent[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const obj = JSON.parse(line) as RgEvent;
        return obj.type === 'match' ? [obj] : [];
      } catch {
        return [];
      }
    });
}

/** Build the plugin definition with injected rg spawn and file-read functions. */
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
  const readFn = deps.readFn ?? readFileLines;

  const handlers = {
    async search(params: SearchParams): Promise<SearchHandlerResult> {
      const term = params.term ?? '';
      const collections = asCollections(params.collections);
      const collectionFilter =
        typeof params.collection === 'string' && params.collection.length > 0 ? params.collection : null;
      const type = params.type ?? 'text';
      const limit = params.limit && params.limit > 0 ? params.limit : 20;
      const fixedStrings = type !== 'regex';

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

      if (roots.length === 0 || term.length === 0) {
        return { hits: [] };
      }

      const stdout = await runRg(spawnFn, term, roots, { fixedStrings, limit });
      const events = parseRgOutput(stdout);

      const seen = new Set<string>();
      const hits: Hit[] = [];

      for (const event of events) {
        if (hits.length >= limit) break;
        const filePath = event.data.path.text;
        if (seen.has(filePath)) continue;
        seen.add(filePath);

        const matched = matchCollection(filePath, activeCollections);
        if (!matched) continue;

        const title = await cheapTitle(filePath, readFn);
        const snippet = (event.data.lines.text || '').trim();

        hits.push({
          collection: matched.collection,
          relPath: matched.relPath,
          title,
          snippet: snippet.length > 0 ? snippet : undefined,
        });
      }

      return { hits };
    },

    async index(): Promise<IndexHandlerResult> {
      return { indexed: 0 };
    },

    async setup(_params: SetupParams, log: PluginLogFn): Promise<SetupHandlerResult> {
      const rgPresent = await rgOnPath(spawnFn);
      if (!rgPresent) {
        log('error', 'ripgrep (rg) not found — install it: https://github.com/BurntSushi/ripgrep');
        return {
          ready: false,
          steps: [
            {
              step: 'verify-rg',
              ok: false,
              message: 'rg not on PATH — install ripgrep: https://github.com/BurntSushi/ripgrep',
            },
          ],
        };
      }
      return {
        ready: true,
        steps: [{ step: 'verify-rg', ok: true }],
      };
    },

    async onEvent(): Promise<EventHandlerResult> {
      return { accepted: true };
    },

    async health(): Promise<HealthHandlerResult> {
      const rgPresent = await rgOnPath(spawnFn);
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
        diagnostics: rgPresent
          ? [{ level: 'ok', message: 'ripgrep ready' }]
          : [
              {
                level: 'error',
                message: 'ripgrep (rg) not found — install it: https://github.com/BurntSushi/ripgrep',
              },
            ],
      };
    },
  };

  const definition: PluginDefinition = {
    name: 'diffwiki-ripgrep',
    kind: 'search' as const,
    version: VERSION,
    capabilities: {
      searchTypes: ['text', 'regex'],
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
