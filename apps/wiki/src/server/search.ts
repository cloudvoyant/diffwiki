import { createServerFn } from '@tanstack/react-start';
import { query, listCollections, listSearchModes } from 'diffwiki-core';
import { hitToResult } from '../lib/search';
import type { SearchResultItem } from '../lib/types';

export interface SearchResponse {
  q: string;
  results: SearchResultItem[];
}

/**
 * Run a search via diffwiki-core and return route-ready results.
 *
 * `engine` is the plugin name (e.g. `'native'`, `'diffwiki-qmd'`); `type` is the
 * search type advertised by that plugin (e.g. `'basic'`, `'keyword'`, `'semantic'`).
 * Both are passed through to `query()` which applies the routing precedence:
 * explicit engine → config.defaultSearch → first enabled plugin → native.
 *
 * A blank `q` short-circuits before any core call so the `/search` landing page
 * (no query yet) is instant.
 */
export const runSearch = createServerFn({ method: 'GET' })
  .validator((d: { q: string; collection?: string; engine?: string; type?: string }) => d)
  .handler(async ({ data }): Promise<SearchResponse> => {
    const q = data.q.trim();
    if (!q) return { q: data.q, results: [] };

    const [hits, collections] = await Promise.all([
      query(q, { engine: data.engine, collection: data.collection, type: data.type }),
      listCollections(),
    ]);

    const results = hits.map((hit) => hitToResult(hit, collections));
    return { q: data.q, results };
  });

/**
 * Return the available search modes from `listSearchModes()`.
 *
 * Always includes at minimum `{ plugin: 'native', type: 'basic', label: 'native · bm25' }`
 * prepended before any installed plugin modes. The `/search` route renders
 * these as `<option>` elements so the dropdown reflects exactly what is installed.
 */
export const getSearchModes = createServerFn({ method: 'GET' }).handler(() => listSearchModes());
