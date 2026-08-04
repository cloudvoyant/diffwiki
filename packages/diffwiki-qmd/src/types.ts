/**
 * Shared domain types for the diffwiki-qmd plugin.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Data types (from bin.ts)
// ---------------------------------------------------------------------------

export interface Collection {
  name: string;
  path: string;
}

export interface QmdRow {
  file?: string;
  displayPath?: string;
  title?: string;
  bestChunk?: string;
  score?: number;
  docid?: string;
  /** Absolute source line the best chunk starts at (qmd's `line` field). */
  line?: number;
}

export interface Hit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  score?: number;
  docid?: string;
  /**
   * The verbatim chunk qmd returned (its diff-style locator + raw markdown),
   * before sanitization. Carried for the search UI's chunk-inspection popover;
   * `snippet` is the cleaned form shown inline.
   */
  rawChunk?: string;
  /**
   * The chunk sanitized to plain text WITHOUT the compact-row truncation — the
   * full cleaned form, for the inspection popover. `snippet` is the same cleaning
   * capped to a short length for inline display.
   */
  cleanedChunk?: string;
  /** Absolute source line the chunk starts at, for "open at line" / inspection. */
  line?: number;
  /**
   * True when `snippet` is a body-preview fallback (qmd's matched chunk was
   * frontmatter/metadata and sanitized to nothing) rather than the cleaned
   * chunk itself. Lets the UI label the snippet honestly.
   */
  snippetFromBody?: boolean;
}

/** Returns the mtime (epoch ms) for a given path, or 0 if the file does not exist. */
export type StatMtimeFn = (filePath: string) => Promise<number>;

export interface QmdStatusInfo {
  docsIndexed: number;
  embeddingsPending: number;
}

// ---------------------------------------------------------------------------
// Daemon types (from daemon.ts)
// ---------------------------------------------------------------------------

/** Minimal fetch-shaped type for the health probe and MCP client. Injected for testability. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** A minimal detached child returned by `SpawnFn` — only `.unref()` is used. */
export interface DetachedChild {
  unref(): void;
}

/** spawn-shaped function for launching the detached daemon. Injected for testability. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; detached?: boolean; stdio?: 'ignore' },
) => DetachedChild;

/** Options for {@link ensureDaemon}. All fields are optional and injectable. */
export interface EnsureDaemonOptions {
  /** Injected fetch. Defaults to global `fetch`. */
  fetchFn?: FetchFn;
  /** Injected spawn. Defaults to `child_process.spawn`. */
  spawnFn?: SpawnFn;
  /**
   * Argv prefix for the qmd binary (e.g. `['/abs/node_modules/@tobilu/qmd/bin/qmd']`
   * or `['qmd']`). Defaults to `['qmd']` (PATH).
   */
  qmdCommand?: readonly string[];
  /** Max number of `/health` poll attempts after a start. Default 30. */
  maxPolls?: number;
  /** Delay between poll attempts, in ms. Default 500. */
  pollIntervalMs?: number;
  /** Per-probe timeout, in ms. Default 1000. */
  probeTimeoutMs?: number;
  /** Sleep function (injected in tests to avoid real timers). Default a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// MCP types (from mcp.ts)
// ---------------------------------------------------------------------------

/** A caller-supplied, pre-expanded query variant (from an upstream LLM/agent). */
export interface SearchExpansion {
  type: 'lex' | 'vec' | 'hyde';
  query: string;
}

/** Arguments for a warm MCP search. */
export interface McpSearchArgs {
  /** The user's search term / query string. */
  term: string;
  /** diffwiki search type: `keyword` | `semantic` | `hybrid`. */
  type: string;
  /** Optional single-collection filter (qmd collection name). */
  collection?: string;
  /** Max results. */
  limit: number;
  /** Minimum score filter (0 disables). */
  minScore?: number;
  /**
   * Pre-expanded query variants. When present these become the qmd `searches`
   * (the agent did the expansion), and `term` is passed only as ranking intent.
   */
  expansions?: SearchExpansion[];
}
