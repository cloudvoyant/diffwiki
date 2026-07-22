import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { listCollections } from './collections';
import { parseArticle } from './frontmatter';
import { readConfig } from './config';
import { CollectionNotFoundError } from './errors';
import { loadSearchProvider, listSearchModes } from './plugins/loader';
import { listEnabledPlugins } from './plugins/registry';
import { NATIVE_ENGINE } from './types';
import type { CollectionEntry, QueryHit, QueryOptions } from './types';

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
      // A single unreadable file or malformed frontmatter (e.g. an unquoted
      // colon in the title, which the strict YAML engine rejects) must never
      // fail the whole search -- degrade that file to its filename and keep going.
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

  // Precompute a per-doc Set of all tokens once so docFreq membership is O(1)
  // instead of rebuilding + scanning the concatenated token array per query term.
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
    // Standard BM25 IDF: ln((N - docFreq + 0.5) / (docFreq + 0.5) + 1)
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
 * explicit engine/type. Mirrors `resolveDefaultEngine`'s precedence and, when the
 * resolved engine is a plugin, prefers the type from `config.defaultSearch`'s
 * `:type` suffix (if that plugin advertises it) else the plugin's first advertised
 * search type. The native engine always resolves to `basic`. UIs use this to
 * pre-select the search-mode dropdown to the engine actually run server-side.
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

  const modes = await listSearchModes();
  const engineModes = modes.filter((m) => m.plugin === engine);
  if (engineModes.length === 0) return { engine: NATIVE_ENGINE, type: 'basic' };
  if (configuredType && engineModes.some((m) => m.type === configuredType)) {
    return { engine, type: configuredType };
  }
  return { engine, type: engineModes[0].type };
}

export async function query(term: string, opts?: QueryOptions): Promise<QueryHit[]> {
  const collections = await listCollections();
  const engine = opts?.engine ?? (await resolveDefaultEngine());
  if (engine === NATIVE_ENGINE) return nativeSearch(term, collections, opts?.collection);
  const provider = await loadSearchProvider(engine);
  if (!provider) return nativeSearch(term, collections, opts?.collection);
  try {
    return await provider.search(term, collections, opts);
  } catch {
    return nativeSearch(term, collections, opts?.collection);
  } finally {
    await provider.close();
  }
}
