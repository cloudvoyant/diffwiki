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
  defaultSearch?: string;
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

export type PluginKind = 'search';
export const NATIVE_ENGINE = 'native';
export interface QueryOptions {
  engine?: string;
  collection?: string;
  type?: string;
  limit?: number;
}
export interface QueryHit {
  collection: string;
  path: string;
  title: string;
  tags: string[];
  snippet?: string;
  score?: number;
  docid?: string;
}
export type DiagnosticLevel = 'ok' | 'warn' | 'error';
export interface Diagnostic {
  level: DiagnosticLevel;
  message: string;
}
export interface PluginRecord {
  name: string;
  kind: PluginKind;
  command: string[];
  version?: string;
  enabled: boolean;
  managed?: boolean;
}
export interface PluginRegistryFile {
  version: number;
  plugins: PluginRecord[];
}
export interface PluginCapabilities {
  searchTypes: string[];
  collectionFilter: boolean;
  hooks: boolean;
  setup: boolean;
}
export interface PluginReadiness {
  toolInstalled: boolean;
  modelsPresent: boolean;
  indexBuilt: boolean;
  docsIndexed: number;
  embeddingsPending: number;
  firstSearchCost: 'instant' | 'model-load' | 'model-download';
}
export interface PluginHealth {
  ready: boolean;
  readiness?: PluginReadiness;
  diagnostics: Diagnostic[];
}
export interface SearchMode {
  plugin: string;
  type: string;
  label: string;
}
export type PluginEvent =
  'collection-added' | 'collection-removed' | 'article-created' | 'article-updated' | 'article-removed';
export interface SearchProvider {
  name: string;
  capabilities: PluginCapabilities;
  setup(
    collections: CollectionEntry[],
    opts?: { embed?: boolean; prefetchModels?: boolean },
  ): Promise<{ ready: boolean }>;
  reindex(collections: CollectionEntry[], opts?: { embed?: boolean }): Promise<number>;
  search(term: string, collections: CollectionEntry[], opts?: QueryOptions): Promise<QueryHit[]>;
  notify(
    event: PluginEvent,
    collection: string,
    relPath: string | undefined,
    collections: CollectionEntry[],
  ): Promise<void>;
  health(collections: CollectionEntry[]): Promise<PluginHealth>;
  close(): Promise<void>;
}
