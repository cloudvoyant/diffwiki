/**
 * Pure, runtime-agnostic BM25 ranking.
 *
 * This module has ZERO Node/filesystem imports, so the exact same ranking runs on
 * the server (native search over files) and in the browser (the static site, over
 * a pre-built index). It is exposed browser-side via the `diffwiki-core/bm25`
 * subpath export so the client bundle never pulls in Node-only core code.
 *
 * @module
 */

/** BM25 parameters. */
const K1 = 1.5;
const B = 0.75;

/** Field-level boost weights. */
const FIELD_WEIGHTS = { title: 3.0, tags: 2.0, collection: 1.5, body: 1.0 } as const;

/** Tokenize a string: lowercase, split on non-alphanumeric, drop empties. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Pre-tokenized, weighted fields of a rankable document. */
export interface RankableFields {
  title: string[];
  tags: string[];
  collection: string[];
  body: string[];
}

/**
 * A document in the serialisable search index: routing metadata (for linking to
 * the article) plus the pre-tokenized fields BM25 ranks. The static exporter
 * writes `SearchDoc[]` to `search-index.json`; the browser ranks it with
 * {@link rankDocs}.
 */
export interface SearchDoc {
  collection: string;
  slug: string;
  title: string;
  tags: string[];
  fields: RankableFields;
}

function termFreqs(tokens: string[]): Map<string, number> {
  const freqs = new Map<string, number>();
  for (const t of tokens) freqs.set(t, (freqs.get(t) ?? 0) + 1);
  return freqs;
}

/** BM25 score for a single field given query terms, its avg length, and per-term IDF. */
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
 * Rank pre-tokenized docs against a query with BM25 over the four weighted fields
 * (title ×3, tags ×2, collection ×1.5, body ×1). Pure — no I/O.
 *
 * An empty/blank query returns every doc unranked (browse-all), preserving the
 * native search's behaviour. Otherwise only matching docs (score > 0) are
 * returned, highest score first. Each returned doc keeps its original shape plus
 * a `score`.
 */
export function rankDocs<T extends { fields: RankableFields }>(term: string, docs: T[]): Array<T & { score?: number }> {
  const queryTerms = tokenize(term);
  if (queryTerms.length === 0) return docs.map((d) => ({ ...d }));

  const N = docs.length;
  const docTokenSets = docs.map(
    (d) => new Set<string>([...d.fields.title, ...d.fields.tags, ...d.fields.collection, ...d.fields.body]),
  );

  const idf = new Map<string, number>();
  for (const qt of queryTerms) {
    let docFreq = 0;
    for (const set of docTokenSets) if (set.has(qt)) docFreq++;
    idf.set(qt, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }

  const avg = (sel: (d: T) => number): number => docs.reduce((s, d) => s + sel(d), 0) / (N || 1);
  const avgLens = {
    title: avg((d) => d.fields.title.length),
    tags: avg((d) => d.fields.tags.length),
    collection: avg((d) => d.fields.collection.length),
    body: avg((d) => d.fields.body.length),
  };

  const scored: Array<T & { score?: number }> = [];
  for (const d of docs) {
    const total =
      bm25FieldScore(queryTerms, d.fields.title, avgLens.title, idf) * FIELD_WEIGHTS.title +
      bm25FieldScore(queryTerms, d.fields.tags, avgLens.tags, idf) * FIELD_WEIGHTS.tags +
      bm25FieldScore(queryTerms, d.fields.collection, avgLens.collection, idf) * FIELD_WEIGHTS.collection +
      bm25FieldScore(queryTerms, d.fields.body, avgLens.body, idf) * FIELD_WEIGHTS.body;
    if (total > 0) scored.push({ ...d, score: total });
  }
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored;
}
