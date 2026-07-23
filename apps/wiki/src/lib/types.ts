export interface NodeMeta {
  branch?: string;
  behind?: number;
}

export interface TreeNode {
  name: string;
  title?: string;
  path?: string;
  children?: TreeNode[];
  /** Set only on top-level collection rows: git branch/behind badge data (omitted in static export). */
  meta?: NodeMeta;
}

export interface CollectionInfo {
  name: string;
  type: 'global' | 'repo' | 'external';
  path: string;
  /** External collections only: checked-out branch (live builds; omitted in static export). */
  branch?: string;
  /** External collections only: commits behind upstream (live builds). */
  behind?: number;
}

export interface CollectionTree {
  collection: CollectionInfo;
  nodes: TreeNode[];
}

export interface TocItem {
  slug: string;
  text: string;
  depth: number;
}

export interface DocData {
  coll: string;
  slug: string;
  title: string;
  tags: string[];
  /** Article body rendered server-side to Shiki-highlighted HTML (mounted directly, no eval). */
  html: string;
  /** TOC (h2/h3) extracted server-side during render. */
  toc: TocItem[];
  path: string;
  /** ISO-8601 creation date, sourced from git history / filesystem (not frontmatter). */
  created?: string;
  /** ISO-8601 last-update date, sourced from git history / filesystem (not frontmatter). */
  updated?: string;
}

/** One row in a generated directory listing. */
export interface ListingEntry {
  name: string;
  title: string;
  path: string;
  isDir: boolean;
}

/**
 * What the `/$coll/$` route renders: either a document (an article or an authored
 * index) or a generated directory listing (folder/collection with no index).
 */
export type PageData =
  ({ kind: 'doc' } & DocData) | { kind: 'listing'; coll: string; slug: string; title: string; entries: ListingEntry[] };

/** One ranked search result, already mapped to route-link params. */
export interface SearchResultItem {
  coll: string;
  slug: string;
  title: string;
  snippet?: string;
  /**
   * Relevance score from the search engine, when it provides one (plugins do;
   * native BM25 does too). Scale is engine/mode-dependent — keyword, semantic,
   * and hybrid are not directly comparable — so it's shown as a raw value to
   * help judge a per-mode cutoff, not as an absolute quality bar.
   */
  score?: number;
}
