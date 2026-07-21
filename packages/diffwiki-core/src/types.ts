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
