/**
 * Search query routing.
 *
 * `query()` is the primary search entry point. It resolves the search engine
 * (explicit opt, config default, first enabled plugin, or native BM25), runs
 * the search, and falls back to native on plugin failure. The built-in native
 * search is a zero-dependency BM25-ranked full-text search across title, body,
 * tags, and collection name.
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { listCollections } from './collections';
import { parseArticle } from './frontmatter';
import { readConfig } from './config';
import { CollectionNotFoundError } from './errors';
import { getLogger } from './logger';
import { loadSearchProvider } from './plugins/host';
import { listEnabledPlugins } from './plugins/registry';
import { NATIVE_ENGINE } from './types';
import { tokenize, rankDocs, type RankableFields } from './bm25';
import type { CollectionEntry, QueryHit, QueryOptions } from './types';

/** Logger for search routing diagnostics. Silent until an app configures LogTape. */
const log = getLogger('query');

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(full)));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// -- Native doc collection (BM25 scoring lives in ./bm25, shared with the browser
// static search so the ranking never diverges) -------------------------------

interface DocEntry {
  collectionName: string;
  filePath: string;
  title: string;
  tags: string[];
  fields: RankableFields;
}

/**
 * Built-in JS-native search: BM25-ranked full-text search over an article's
 * title, body, tags, and collection name -- across every registered collection's
 * ABSOLUTE registry path (so in-repo wikis outside ~/.diffwiki are searched too).
 * No `find`/OS shelling -- cross-platform and dependency-free.
 *
 * When `term` is empty, returns all articles unranked (no score) to preserve
 * the "browse all" behavior.
 */
export async function nativeSearch(
  term: string,
  collections: CollectionEntry[],
  collection?: string,
): Promise<QueryHit[]> {
  let targets = collections;
  if (collection) {
    const one = collections.find((c) => c.name === collection);
    if (!one) throw new CollectionNotFoundError(collection);
    targets = [one];
  }

  // Gather all documents
  const docs: DocEntry[] = [];
  for (const entry of targets) {
    for (const full of await collectMarkdownFiles(entry.path)) {
      const fallbackTitle = path.basename(full).replace(/\.mdx?$/, '');
      let title = fallbackTitle;
      let tags: string[] = [];
      let body = '';
      try {
        const parsed = parseArticle(await fs.readFile(full, 'utf8'));
        if (parsed.title) title = parsed.title;
        tags = parsed.tags;
        body = parsed.body;
      } catch {
        /* keep the filename fallback */
      }
      docs.push({
        collectionName: entry.name,
        filePath: full,
        title,
        tags,
        fields: {
          title: tokenize(title),
          tags: tokenize(tags.join(' ')),
          collection: tokenize(entry.name),
          body: tokenize(body),
        },
      });
    }
  }

  // Rank with the shared BM25 scorer (empty term → all docs unranked).
  return rankDocs(term, docs).map((d) => ({
    collection: d.collectionName,
    path: d.filePath,
    title: d.title,
    tags: d.tags,
    ...(d.score === undefined ? {} : { score: d.score }),
  }));
}

/**
 * Resolve the engine name to use when the caller did not pass `opts.engine`:
 * `config.defaultSearch` (a "<plugin>[:<type>]" string; the `:type` suffix is
 * stripped) when it names an enabled search plugin, else the first enabled search
 * plugin, else the built-in native engine.
 */
async function resolveDefaultEngine(): Promise<string> {
  const config = await readConfig();
  const enabled = await listEnabledPlugins('search');
  const configured = config.defaultSearch?.split(':')[0];
  if (configured && enabled.some((p) => p.name === configured)) return configured;
  if (enabled.length > 0) return enabled[0].name;
  return NATIVE_ENGINE;
}

/**
 * Resolve the engine + type that `query()` would use when the caller passes no
 * explicit engine/type. Reads cached capabilities from the registry -- no spawn.
 */
export async function resolveDefaultSearchMode(): Promise<{ engine: string; type: string }> {
  const config = await readConfig();
  const enabled = await listEnabledPlugins('search');
  const configured = config.defaultSearch?.split(':')[0];
  const configuredType = config.defaultSearch?.split(':')[1];

  let engine = NATIVE_ENGINE;
  if (configured && enabled.some((p) => p.name === configured)) engine = configured;
  else if (enabled.length > 0) engine = enabled[0].name;

  if (engine === NATIVE_ENGINE) return { engine, type: 'basic' };

  // Read capabilities from the registry instead of spawning.
  const record = enabled.find((p) => p.name === engine);
  const searchTypes = record?.capabilities?.searchTypes ?? [];
  if (searchTypes.length === 0) return { engine: NATIVE_ENGINE, type: 'basic' };

  if (configuredType && searchTypes.includes(configuredType)) {
    return { engine, type: configuredType };
  }
  return { engine, type: searchTypes[0] };
}

/**
 * The result of a {@link search} call: the hits plus the metadata a host UI
 * needs to tell the user WHICH engine ran and whether it silently degraded.
 *
 * `fellBackToNative` is true whenever the resolved engine could not serve the
 * search (no provider, or `handleSearch` threw) and native BM25 produced these
 * hits instead. `error`, when set, is the captured message from the failing
 * engine — a failing engine is thus distinguishable from an engine that
 * legitimately found zero results.
 */
export interface SearchOutcome {
  /** The hits to display (from the engine, or from native on fallback). */
  hits: QueryHit[];
  /** The engine that was resolved and attempted (may differ from what produced `hits`). */
  engine: string;
  /** True when native BM25 produced `hits` because the engine failed/was unavailable. */
  fellBackToNative: boolean;
  /** The captured failure message from the engine, when it errored. */
  error?: string;
}

/**
 * Search articles via the resolved search engine, surfacing engine failures.
 *
 * Routing precedence: explicit `opts.engine` -> `config.defaultSearch` ->
 * first enabled plugin -> native BM25.
 *
 * On ANY engine failure (no provider, or `handleSearch` throws) the error
 * message is CAPTURED, native BM25 is run as a fallback, and the outcome
 * reports `{ fellBackToNative: true, error }`. On success it reports
 * `{ fellBackToNative: false }` with the engine's hits. This lets callers
 * distinguish "the engine broke" from "the engine found nothing".
 */
export async function search(term: string, opts?: QueryOptions): Promise<SearchOutcome> {
  const collections = await listCollections();
  const engine = opts?.engine ?? (await resolveDefaultEngine());
  log.debug(`resolved search engine "${engine}"`);
  if (engine === NATIVE_ENGINE) {
    const hits = await nativeSearch(term, collections, opts?.collection);
    return { hits, engine, fellBackToNative: false };
  }
  const provider = await loadSearchProvider(engine);
  if (!provider) {
    const error = `no provider found for engine "${engine}"`;
    log.warn(`engine "${engine}" unavailable, falling back to native: ${error}`);
    const hits = await nativeSearch(term, collections, opts?.collection);
    return { hits, engine, fellBackToNative: true, error };
  }
  try {
    const hits = await provider.handleSearch(term, collections, opts);
    return { hits, engine, fellBackToNative: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`engine "${engine}" failed, falling back to native: ${message}`);
    const hits = await nativeSearch(term, collections, opts?.collection);
    return { hits, engine, fellBackToNative: true, error: message };
  }
}

/**
 * Search articles via the resolved search engine (native fallback on plugin
 * failure). A thin wrapper over {@link search} that returns just the hits;
 * engine errors are swallowed. Use {@link search} to surface those errors.
 *
 * Routing precedence: explicit `opts.engine` -> `config.defaultSearch` ->
 * first enabled plugin -> native BM25.
 */
export async function query(term: string, opts?: QueryOptions): Promise<QueryHit[]> {
  return (await search(term, opts)).hits;
}
