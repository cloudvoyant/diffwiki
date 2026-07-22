export interface TreeNode {
  name: string;
  title?: string;
  path?: string;
  children?: TreeNode[];
}

export interface CollectionInfo {
  name: string;
  type: 'global' | 'repo';
  path: string;
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
