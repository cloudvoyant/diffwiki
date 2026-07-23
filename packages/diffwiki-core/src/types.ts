export type CollectionType = 'global' | 'repo' | 'external';

export interface CollectionEntry {
  name: string;
  type: CollectionType;
  /** Absolute path to the collection's content directory. */
  path: string;
  createdAt: string;
  /** External only: stable git repo id (see `repoId`). Identity + dedupe key. */
  id?: string;
  /** External only: absolute repo root (branch/behind + open-at-root). */
  repoRoot?: string;
  /** External only: content dir relative to `repoRoot` (default "docs"). */
  docsDir?: string;
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
  /** Capabilities cached at install/register time via the `describe` op. */
  capabilities?: PluginCapabilities;
  enabled: boolean;
  managed?: boolean;
}
export interface PluginRegistryFile {
  version: number;
  plugins: PluginRecord[];
}
/** Capabilities a plugin advertises via the `describe` op, cached in the registry. */
export interface PluginCapabilities {
  /** Search types the plugin supports (e.g. `['keyword', 'semantic', 'hybrid']`). */
  searchTypes: string[];
  /** Whether the plugin supports filtering results by collection. */
  collectionFilter: boolean;
  /** Whether the plugin handles lifecycle events (article/collection mutations). */
  events: boolean;
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
/**
 * Host-side facade for a search plugin. Each method is backed by a one-shot
 * subprocess invocation -- there is no persistent process and no `close()`.
 */
export interface SearchProvider {
  /** Plugin name. */
  name: string;
  /** Plugin capabilities (cached from the `describe` op). */
  capabilities: PluginCapabilities;
  /** Run a search query and return hits with absolute paths. */
  handleSearch(term: string, collections: CollectionEntry[], opts?: QueryOptions): Promise<QueryHit[]>;
  /** Rebuild the search index. Returns the number of documents indexed. */
  reindex(collections: CollectionEntry[], opts?: { embed?: boolean }): Promise<number>;
  /** Emit a lifecycle event to the plugin (best-effort). */
  emitEvent(
    event: PluginEvent,
    collection: string,
    relPath: string | undefined,
    collections: CollectionEntry[],
  ): Promise<void>;
  /** Check plugin health and readiness. */
  health(collections: CollectionEntry[]): Promise<PluginHealth>;
}

// ── Site view types (consumed by the wiki app + static exporter) ─────────────

export interface NodeMeta {
  branch?: string;
  behind?: number;
}

export interface TreeNode {
  name: string;
  title?: string;
  path?: string;
  children?: TreeNode[];
  /** Set only on top-level collection rows: git branch/behind badge data. */
  meta?: NodeMeta;
}

export interface CollectionInfo {
  name: string;
  type: CollectionType;
  path: string;
  branch?: string;
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
  html: string;
  toc: TocItem[];
  path: string;
}

export interface ListingEntry {
  name: string;
  title: string;
  path: string;
  isDir: boolean;
}

export type PageData =
  ({ kind: 'doc' } & DocData) | { kind: 'listing'; coll: string; slug: string; title: string; entries: ListingEntry[] };
