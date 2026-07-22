/**
 * Shared domain types for the diffwiki-ripgrep plugin.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// ripgrep helper types (from ripgrep.ts)
// ---------------------------------------------------------------------------

/** Injectable spawn function -- resolves raw stdout from `rg <args>`. Exit 1 -> empty string. Throws on exit 2+. */
export type SpawnRgFn = (args: string[]) => Promise<string>;

/** Injectable file-lines reader -- returns up to 20 lines for `cheapTitle`. */
export type ReadFileFn = (absPath: string) => Promise<string[]>;

export interface RunRgOptions {
  /** Use fixed-strings mode (`--fixed-strings -i`). When false, regex mode (default). */
  fixedStrings: boolean;
  /** Max matches returned per rg invocation. Default 20. */
  limit: number;
}

// ---------------------------------------------------------------------------
// Plugin data types (from bin.ts)
// ---------------------------------------------------------------------------

export interface Collection {
  name: string;
  path: string;
}

/** A single parsed rg --json match event (the `data` sub-object). */
export interface RgMatchData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
}

/** A top-level rg --json event line. */
export interface RgEvent {
  type: string;
  data: RgMatchData;
}

export interface Hit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
}

export interface Deps {
  spawnFn?: SpawnRgFn;
  readFn?: ReadFileFn;
}
