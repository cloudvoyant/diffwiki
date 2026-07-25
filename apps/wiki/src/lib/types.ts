// Knowledge-graph types — single source of truth in diffwiki-core, imported here so the
// app can both use them (e.g. DocData.graph) and re-export them for the graph UI.
import type { GraphNode, GraphEdge, LinkGraph, LocalGraph } from 'diffwiki-core';
export type { GraphNode, GraphEdge, LinkGraph, LocalGraph };

/** Audience axis — who an article is for (mirrors diffwiki-core). Private is never published. */
export type Audience = 'public' | 'private';
/** Lifecycle axis — readiness (mirrors diffwiki-core). Draft is not yet published. */
export type PublishStatus = 'draft' | 'published';

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
  /** Collection audience (from its index page); present only when 'private'. */
  audience?: Audience;
  /** Collection lifecycle status (from its index page); present only when 'draft'. */
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
  /** Article body rendered server-side to Shiki-highlighted HTML (mounted directly, no eval). */
  html: string;
  /** TOC (h2/h3) extracted server-side during render. */
  toc: TocItem[];
  path: string;
  /** ISO-8601 creation date, sourced from git history / filesystem (not frontmatter). */
  created?: string;
  /** ISO-8601 last-update date, sourced from git history / filesystem (not frontmatter). */
  updated?: string;
  /** Local knowledge-graph neighbourhood for this page (this node + its direct links). */
  graph: LocalGraph;
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
