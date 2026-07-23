import { getNavTree, getCollections } from '../server/collections';
import { readPage } from '../server/doc';
import { runSearch, getSearchModes, type SearchResponse, type SearchModesResponse } from '../server/search';
import { rankDocs, type SearchDoc } from 'diffwiki-core/bm25';
import type { CollectionInfo, CollectionTree, PageData } from './types';

const STATIC = import.meta.env.VITE_DIFFWIKI_STATIC === '1';
const BASE = import.meta.env.BASE_URL; // "/" or "/my-repo/"

/** Absolute origin for data fetches: the page origin in the browser, an injected
 *  origin during SSR/prerender (Node fetch requires absolute URLs). */
function origin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return (globalThis as { __DIFFWIKI_ORIGIN__?: string }).__DIFFWIKI_ORIGIN__ ?? 'http://localhost';
}

/** A failed data fetch, carrying the HTTP status so callers can distinguish a
 *  genuine 404 miss from a corrupt file / transport error. */
class DataFetchError extends Error {
  constructor(
    public readonly status: number,
    rel: string,
  ) {
    super(`data fetch failed: ${rel} (${status})`);
    this.name = 'DataFetchError';
  }
}

async function json<T>(rel: string): Promise<T> {
  const res = await fetch(`${origin()}${BASE}_data/${rel}`);
  if (!res.ok) throw new DataFetchError(res.status, rel);
  return (await res.json()) as T;
}

export function loadNavTree(): Promise<CollectionTree[]> {
  return STATIC ? json<CollectionTree[]>('nav-tree.json') : getNavTree();
}

export function loadCollections(): Promise<CollectionInfo[]> {
  return STATIC ? json<CollectionInfo[]>('collections.json') : getCollections();
}

export function loadPage(coll: string, slug: string): Promise<PageData | null> {
  if (!STATIC) return readPage({ data: { coll, slug } });
  // Static: per-doc JSON at _data/doc/<coll>/<slug>.json; empty slug → index.json.
  // Article slug "index" never occurs (index/README files are folder indexes,
  // dropped by the tree builder), so there is no collision with the root index.
  const rel = slug ? `doc/${coll}/${slug}.json` : `doc/${coll}/index.json`;
  // A missing per-doc file in the frozen bundle is a genuine 404 → render "not
  // found". Any other failure (corrupt JSON, transport error, non-404 status)
  // must surface rather than masquerade as a missing page.
  return json<PageData | null>(rel).catch((err: unknown) => {
    if (err instanceof DataFetchError && err.status === 404) return null;
    throw err;
  });
}

export interface SearchArgs {
  q: string;
  c?: string;
  engine?: string;
  type?: string;
}

// The static search index is a root asset (not under _data/); fetched + cached once.
let staticIndex: Promise<SearchDoc[]> | undefined;
function loadStaticIndex(): Promise<SearchDoc[]> {
  return (staticIndex ??= fetch(`${origin()}${BASE}search-index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<SearchDoc[]>) : []))
    .catch(() => []));
}

/**
 * The `/search` page's results. Live: the server `runSearch` (native BM25 or a
 * plugin engine). Static: the SAME BM25 scorer (`rankDocs`) over the pre-built
 * index, client-side — so the static /search page renders identically to live.
 */
export async function loadSearch(args: SearchArgs): Promise<SearchResponse> {
  if (!STATIC) {
    return runSearch({ data: { q: args.q, collection: args.c, engine: args.engine, type: args.type } });
  }
  const q = args.q.trim();
  if (!q) return { q: args.q, results: [], tookMs: 0 };
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let docs = await loadStaticIndex();
  if (args.c) docs = docs.filter((d) => d.collection === args.c);
  const results = rankDocs(q, docs).map((d) => ({ coll: d.collection, slug: d.slug, title: d.title, score: d.score }));
  const tookMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  return { q: args.q, results, tookMs };
}

export function loadSearchModes(): Promise<SearchModesResponse> {
  // Static builds ship only native BM25 (plugin engines need a server), so there's
  // no mode dropdown — an empty list hides it in the /search route.
  return STATIC ? Promise.resolve({ modes: [], default: { engine: 'native', type: 'basic' } }) : getSearchModes();
}
