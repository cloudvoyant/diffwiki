export type CollectionType = 'global' | 'repo';

export interface CollectionEntry {
  name: string;
  type: CollectionType;
  /** Absolute path to the collection's directory. */
  path: string;
  createdAt: string;
}

export interface Registry {
  version: number;
  collections: CollectionEntry[];
}

export interface Config {
  defaultCollection?: string;
}

export interface Article {
  title: string;
  tags: string[];
  /** Absolute path to the article file. */
  path: string;
  collection: string;
}

export interface RepoConfig {
  collection: string;
  /** Path to the wiki directory, relative to the repo root. */
  path: string;
}

/** A node in a collection's article tree. Branches have `children`; leaves have `slug`. */
export interface ArticleNode {
  /** Segment label — dir name for branches, filename-without-ext for leaves. */
  name: string;
  /** Display title — frontmatter `title` (leaf) or the folder's index title, else `name`. */
  title?: string;
  /**
   * Path within the collection, without extension, e.g. "guide/setup". Set on
   * leaves (the article) and on branches (the folder, navigable to its index).
   */
  slug?: string;
  /** Branch only: nested nodes. */
  children?: ArticleNode[];
}

/** A resolved article's content, returned by `readArticle`. */
export interface ArticleContent {
  coll: string;
  slug: string;
  title: string;
  tags: string[];
  /** Frontmatter-stripped body (md/mdx). */
  body: string;
  /** Absolute path to the file on disk. */
  path: string;
}
