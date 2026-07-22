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
import { loadSearchProvider } from './plugins/loader';
import { listEnabledPlugins } from './plugins/registry';
import { NATIVE_ENGINE } from './types';
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

// -- BM25 scoring helpers (zero dependencies) ---------------------------------

/** BM25 parameters. */
const K1 = 1.5;
const B = 0.75;

/** Field-level boost weights. */
const FIELD_WEIGHTS = { title: 3.0, tags: 2.0, collection: 1.5, body: 1.0 } as const;

/** Tokenize a string: lowercase, split on non-alphanumeric, drop empties. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Count term frequencies in a token array. */
function termFreqs(tokens: string[]): Map<string, number> {
  const freqs = new Map<string, number>();
  for (const t of tokens) {
    freqs.set(t, (freqs.get(t) ?? 0) + 1);
  }
  return freqs;
}

interface DocFields {
  title: string[];
  tags: string[];
  collection: string[];
  body: string[];
}

interface DocEntry {
  collectionName: string;
  filePath: string;
  title: string;
  tags: string[];
  fields: DocFields;
}

/**
 * Compute BM25 score for a single field given query terms.
 * @param queryTerms tokenized query
 * @param fieldTokens tokenized field content
 * @param avgFieldLen average field length across all docs
 * @param idf IDF map for each query term
 */
function bm25FieldScore(
  queryTerms: string[],
  fieldTokens: string[],
  avgFieldLen: number,
  idf: Map<string, number>,
): number {
  const tf = termFreqs(fieldTokens);
  const dl = fieldTokens.length;
  const avgDl = avgFieldLen || 1;
  let score = 0;
  for (const term of queryTerms) {
    const freq = tf.get(term) ?? 0;
    if (freq === 0) continue;
    const termIdf = idf.get(term) ?? 0;
    const numerator = freq * (K1 + 1);
    const denominator = freq + K1 * (1 - B + B * (dl / avgDl));
    score += termIdf * (numerator / denominator);
  }
  return score;
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

  // Empty term: return all articles unranked (preserve browse-all behavior)
  if (!term.trim()) {
    return docs.map((d) => ({
      collection: d.collectionName,
      path: d.filePath,
      title: d.title,
      tags: d.tags,
    }));
  }

  const queryTerms = tokenize(term);
  if (queryTerms.length === 0) {
    return docs.map((d) => ({
      collection: d.collectionName,
      path: d.filePath,
      title: d.title,
      tags: d.tags,
    }));
  }

  const docTokenSets = docs.map(
    (doc) => new Set<string>([...doc.fields.title, ...doc.fields.tags, ...doc.fields.collection, ...doc.fields.body]),
  );

  // Compute IDF for each query term across the corpus
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const qt of queryTerms) {
    let docFreq = 0;
    for (const tokenSet of docTokenSets) {
      if (tokenSet.has(qt)) docFreq++;
    }
    idf.set(qt, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }

  // Compute average field lengths
  const avgLens = {
    title: docs.reduce((sum, d) => sum + d.fields.title.length, 0) / (N || 1),
    tags: docs.reduce((sum, d) => sum + d.fields.tags.length, 0) / (N || 1),
    collection: docs.reduce((sum, d) => sum + d.fields.collection.length, 0) / (N || 1),
    body: docs.reduce((sum, d) => sum + d.fields.body.length, 0) / (N || 1),
  };

  // Score each document
  const scored: Array<{ doc: DocEntry; score: number }> = [];
  for (const doc of docs) {
    const titleScore = bm25FieldScore(queryTerms, doc.fields.title, avgLens.title, idf) * FIELD_WEIGHTS.title;
    const tagsScore = bm25FieldScore(queryTerms, doc.fields.tags, avgLens.tags, idf) * FIELD_WEIGHTS.tags;
    const collScore =
      bm25FieldScore(queryTerms, doc.fields.collection, avgLens.collection, idf) * FIELD_WEIGHTS.collection;
    const bodyScore = bm25FieldScore(queryTerms, doc.fields.body, avgLens.body, idf) * FIELD_WEIGHTS.body;
    const total = titleScore + tagsScore + collScore + bodyScore;
    if (total > 0) {
      scored.push({ doc, score: total });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => ({
    collection: s.doc.collectionName,
    path: s.doc.filePath,
    title: s.doc.title,
    tags: s.doc.tags,
    score: s.score,
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
