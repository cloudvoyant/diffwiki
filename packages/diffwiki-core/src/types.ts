/** Audience axis — who an article is for. Private is never published; system is diffwiki-internal (hidden unless `showSystem`). Missing/invalid → 'public'. */
export type Audience = 'public' | 'private' | 'system';
/** Lifecycle axis — readiness. Draft is unpublished; deprecated is superseded. Missing/invalid → 'published'. */
export type PublishStatus = 'draft' | 'published' | 'deprecated';

export type CollectionType = 'global' | 'repo' | 'external';

export interface CollectionEntry {
  name: string;
  type: CollectionType;
  /** Absolute path to the collection's content directory. */
  path: string;
  createdAt: string;
  /** Marks a diffwiki-internal collection (e.g. `transcripts`). 'system' hides it unless `showSystem`. */
  audience?: Audience;
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
  /** Editor command used by `diffwiki edit` (e.g. "code -w", "hx"). Falls back to $VISUAL/$EDITOR. */
  editor?: string;
  /** Reveal system-audience content in search, nav, and the UI (default: false). Stored as boolean or "true". */
  showSystem?: boolean;
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

/** A home-page card (VitePress-style): icon + title + subtitle linking into the site. */
export interface HomeCard {
  /** Icon name from the curated home-card icon set; unknown/missing → no icon. */
  icon?: string;
  title: string;
  subtitle?: string;
  /** In-site path, e.g. "/getting-started". */
  link: string;
}

/** Home-page customization from `diffwiki.yaml` → `site.home`. */
export interface SiteHome {
  /** Line shown under the wordmark on the home page. */
  tagline?: string;
  /** Cards rendered below the search bar. */
  cards?: HomeCard[];
}

/** Footer copyright notice from `diffwiki.yaml` → `site.copyright`. Applies to the
 *  site/software; article CONTENT copyright stays with its respective authors. */
export interface SiteCopyright {
  /** The full notice text, e.g. "© 2026 Acme, Inc." */
  text: string;
  /** Optional URL — renders the notice as a link. */
  url?: string;
}

/** Site-level config from `diffwiki.yaml` → `site`. The diffwiki logo + wordmark
 *  are fixed branding and deliberately not configurable. */
export interface SiteConfig {
  /** Project repository URL for the top-nav GitHub link. */
  repo?: string;
  /** Footer copyright notice; no default — the footer is empty when unset. */
  copyright?: SiteCopyright;
  home?: SiteHome;
}

/** One collection declared in `diffwiki.yaml` → `collections[]`. */
export interface ProjectCollection {
  name: string;
  /** Content directory, relative to the project root. */
  path: string;
  /** Optional display order (ascending). Unset sorts after ordered ones, keeping list order. */
  order?: number;
}

/** Optional recall/search context from `diffwiki.yaml` → `context`. */
export interface ProjectContext {
  /** Collection names recall/search should filter to by default. */
  collections: string[];
}

/**
 * Normalised repo-root `diffwiki.yaml`. The extended form carries `site` +
 * `collections[]`; the legacy `{ collection, path }` form is folded into a
 * one-element `collections` by the parser.
 */
export interface ProjectConfig {
  site?: SiteConfig;
  collections: ProjectCollection[];
  context?: ProjectContext;
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
  /** Audience, set only when 'private' (omitted for 'public'). */
  audience?: Audience;
  /** Lifecycle status, set only when 'draft' (omitted for 'published'). */
  status?: PublishStatus;
  /** Frontmatter `order` — nav sort within a folder (ascending; unset sorts after). */
  order?: number;
  /** Branch only: nested nodes. */
  children?: ArticleNode[];
}

/** A resolved article's content, returned by `readArticle`. */
export interface ArticleContent {
  coll: string;
  slug: string;
  title: string;
  tags: string[];
  /** Audience from frontmatter ('public' when absent). */
  audience: Audience;
  /** Lifecycle status from frontmatter ('published' when absent). */
  status: PublishStatus;
  /** Frontmatter-stripped body (md/mdx). */
  body: string;
  /** Absolute path to the file on disk. */
  path: string;
  /**
   * True when the resolved file is a folder-index page (`<slug>/index.md` or
   * `<slug>/README.md`) rather than a leaf `<slug>.md`. The route slug is the
   * same for both, so this flag is needed to resolve folder-local relative
   * links against the article's own folder.
   */
  isIndex: boolean;
}

export type PluginKind = 'search';
export const NATIVE_ENGINE = 'native';

// Canonical definition lives in the plugin SDK (`plugins/types.ts`), re-exported
// here so host-side code that imports from `diffwiki-core` gets the same type.
import type { SearchExpansion } from './plugins/types';
export type { SearchExpansion };

export interface QueryOptions {
  engine?: string;
  /** Limit to a single collection name, or a set of names. Empty/undefined = all. */
  collection?: string | string[];
  type?: string;
  limit?: number;
  /** Reveal system-audience content (default: config `showSystem`, else false). */
  showSystem?: boolean;
  /**
   * Pre-expanded query variants (from a smarter upstream LLM). When present, an
   * engine that supports structured search should use these instead of expanding
   * the bare term itself. The `term` is still passed as ranking intent.
   */
  expansions?: SearchExpansion[];
}
export interface QueryHit {
  collection: string;
  path: string;
  title: string;
  tags: string[];
  snippet?: string;
  score?: number;
  docid?: string;
  /** Verbatim engine chunk (unsanitized) for the search UI's inspection popover. */
  rawChunk?: string;
  /** The chunk cleaned to plain text, untruncated (full form for the popover). */
  cleanedChunk?: string;
  /** Absolute source line the chunk starts at, when the engine reports it. */
  line?: number;
  /** True when `snippet` is a body-preview fallback rather than the cleaned chunk. */
  snippetFromBody?: boolean;
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
  /** Audience; present only when 'private' (drives the sidebar lock). */
  audience?: Audience;
  /** Lifecycle status; present only when 'draft' (drives the sidebar DRAFT tag). */
  status?: PublishStatus;
  children?: TreeNode[];
  /** Set only on top-level collection rows: git branch/behind badge data. */
  meta?: NodeMeta;
}

export interface CollectionInfo {
  name: string;
  type: CollectionType;
  path: string;
  /** Display title from the collection's root index page frontmatter; falls back to `name` in the UI. */
  title?: string;
  branch?: string;
  behind?: number;
  /** Audience from the collection's root index page; present only when 'private'. */
  audience?: Audience;
  /** Lifecycle status from the collection's root index page; present only when 'draft'. */
  status?: PublishStatus;
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
  /** Audience; present only when 'private'. */
  audience?: Audience;
  /** Lifecycle status; present only when 'draft'. */
  status?: PublishStatus;
  html: string;
  toc: TocItem[];
  path: string;
  /** ISO-8601 creation date, sourced from git history / filesystem (not frontmatter). */
  created?: string;
  /** ISO-8601 last-update date, sourced from git history / filesystem (not frontmatter). */
  updated?: string;
  /** Local knowledge-graph neighbourhood for this page (this node + its direct links). */
  graph: LocalGraph;
}

export interface ListingEntry {
  name: string;
  title: string;
  path: string;
  isDir: boolean;
}

export type PageData =
  ({ kind: 'doc' } & DocData) | { kind: 'listing'; coll: string; slug: string; title: string; entries: ListingEntry[] };

// ── Knowledge graph view types (consumed by the wiki app + static exporter) ───

/**
 * One node in the knowledge graph. Two kinds:
 * - `article` — a wiki page. `id` is `"<coll>/<slug>"`, with `coll`/`slug` set.
 * - `tag` — an Obsidian-style tag hub. `id` is `"tag:<name>"`; `coll`/`slug` are
 *   empty (a tag is not a page, so clicking it never navigates), `title` is `#name`.
 */
export interface GraphNode {
  id: string;
  kind: 'article' | 'tag';
  coll: string;
  slug: string;
  title: string;
}

/**
 * A graph edge. `kind` distinguishes an explicit hyperlink between two articles
 * (`link`) from an article↔tag-hub membership edge (`tag`). For `link` edges the
 * direction (source→target) is the link direction; `tag` edges go article→tag.
 */
export interface GraphEdge {
  source: string;
  target: string;
  kind: 'link' | 'tag';
}

/** The whole-wiki knowledge graph. */
export interface LinkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The local neighbourhood of one node: the node itself plus its directly linked
 * (outgoing) and linking (incoming) neighbours, and the edges among them. `focus`
 * is the id of the page this neighbourhood is centred on.
 */
export interface LocalGraph {
  focus: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
