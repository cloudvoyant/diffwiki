/**
 * Shared domain types for the diffwiki-ripgrep plugin.
 *
 * @module
 */

import type { EnsureToolSpec, EnsureToolOptions, EnsureToolResult } from 'diffwiki-core/plugin';

/** Injectable auto-installer (defaults to core's `ensureTool`). */
export type EnsureToolFn = (spec: EnsureToolSpec, opts?: EnsureToolOptions) => Promise<EnsureToolResult>;

// ---------------------------------------------------------------------------
// Process helper types (from ripgrep.ts)
// ---------------------------------------------------------------------------

/** Injectable rg spawner — resolves raw stdout from `rg <args>`. Exit 1 (no matches) -> empty string; throws on exit 2+. */
export type SpawnRgFn = (args: string[]) => Promise<string>;

/** Injectable fzf spawner — pipes `input` to `fzf <args>` stdin, resolves stdout. Exit 1 (no matches) -> empty string; throws on exit 2+. */
export type SpawnFzfFn = (args: string[], input: string) => Promise<string>;

/** Injectable file-lines reader — returns up to 20 lines for `cheapTitle`. */
export type ReadFileFn = (absPath: string) => Promise<string[]>;

export interface RunRgOptions {
  /** Max candidate lines to emit per file. Default 20. */
  limit: number;
}

// ---------------------------------------------------------------------------
// Plugin data types (from bin.ts)
// ---------------------------------------------------------------------------

export interface Collection {
  name: string;
  path: string;
}

/** A ripgrep candidate line (`path:line:text`), parsed. */
export interface RgLine {
  path: string;
  lineNumber: number;
  text: string;
}

export interface Hit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  /**
   * A rank-derived relevance score in (0, 1], assigned only when fzf ranked the
   * results (best hit = 1, descending). Omitted on the plain-ripgrep fallback,
   * where result order is file-discovery order, not relevance.
   */
  score?: number;
}

export interface Deps {
  spawnFn?: SpawnRgFn;
  fzfFn?: SpawnFzfFn;
  readFn?: ReadFileFn;
  /** Auto-installer for missing system tools (rg/fzf). Defaults to core's `ensureTool`. */
  installFn?: EnsureToolFn;
}
