import { createServerFn } from '@tanstack/react-start';
import {
  search,
  listCollections,
  listSearchModes,
  resolveDefaultSearchMode,
  showSystemEnabled,
  type SearchMode,
} from 'diffwiki-core';
import { hitToResult } from '../lib/search';
import type { SearchResultItem } from '../lib/types';

export interface SearchResponse {
  q: string;
  results: SearchResultItem[];
  /** Wall-clock time the search took on the server, in milliseconds. */
  tookMs: number;
  /**
   * When the resolved search engine failed and native results were served
   * instead, the captured engine error message. Undefined on success.
   */
  engineError?: string;
}

export interface SearchModesResponse {
  modes: SearchMode[];
  /** The engine+type `query()` uses when the request omits engine/type. */
  default: { engine: string; type: string };
}

/**
 * Run a search via diffwiki-core and return route-ready results.
 *
 * `engine` is the plugin name (e.g. `'native'`, `'diffwiki-qmd'`); `type` is the
 * search type advertised by that plugin (e.g. `'basic'`, `'keyword'`, `'semantic'`).
 * Both are passed through to `search()` which applies the routing precedence:
 * explicit engine → config.defaultSearch → first enabled plugin → native. When
 * the engine fails, `search()` falls back to native and reports the error via
 * `engineError` so the route can warn the user.
 *
 * A blank `q` short-circuits before any core call so the `/search` landing page
 * (no query yet) is instant.
 */
export const runSearch = createServerFn({ method: 'GET' })
  .validator((d: { q: string; collection?: string; engine?: string; type?: string }) => d)
  .handler(async ({ data }): Promise<SearchResponse> => {
    const q = data.q.trim();
    if (!q) return { q: data.q, results: [], tookMs: 0 };

    const started = Date.now();
    const showSystem = await showSystemEnabled();
    const [outcome, collections] = await Promise.all([
      search(q, { engine: data.engine, collection: data.collection, type: data.type, showSystem }),
      listCollections(),
    ]);
    const tookMs = Date.now() - started;

    const results = outcome.hits.map((hit) => hitToResult(hit, collections));
    return { q: data.q, results, tookMs, engineError: outcome.error };
  });

/**
 * Return the available search modes plus the default engine+type the server
 * actually runs when the request omits engine/type.
 *
 * `modes` always includes at minimum `{ plugin: 'native', type: 'basic', label: 'native · bm25' }`
 * prepended before any installed plugin modes. The `/search` route renders these
 * as `<option>` elements and pre-selects `default` so the dropdown reflects the
 * engine that would actually run (which may be the first enabled plugin, not native).
 */
export const getSearchModes = createServerFn({ method: 'GET' }).handler(async (): Promise<SearchModesResponse> => {
  const [modes, def] = await Promise.all([listSearchModes(), resolveDefaultSearchMode()]);
  return { modes, default: def };
});
