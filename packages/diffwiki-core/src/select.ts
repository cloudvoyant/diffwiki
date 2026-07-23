/**
 * Collection selection for `diffwiki export` — resolve which collection names to
 * keep given `--filter` / `--exclude` glob patterns. Pure (no I/O), so the CLI can
 * fail upfront and the export harness can filter its output from one matcher.
 *
 * @module
 */

export interface CollectionSelection {
  /** Include globs; when empty/undefined, every collection is included. */
  filter?: string[];
  /** Exclude globs, applied after the filter. */
  exclude?: string[];
}

export interface CollectionSelectionResult {
  /** Collection names to keep, in the input order. */
  included: string[];
  /** Human-readable problems (unmatched pattern, empty result). Empty ⇒ OK. */
  errors: string[];
}

/** Glob → anchored RegExp. Supports `*` (any run, incl. empty) and `?` (one char). */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(name));
}

/**
 * Resolve the export selection from `--filter`/`--exclude` globs over the set of
 * registered collection names. Pure. It REPORTS (does not throw) every problem so
 * callers can fail upfront before generating anything:
 *   - a `--filter` or `--exclude` pattern that matches no registered collection, or
 *   - a selection that ends up empty AFTER a filter/exclude was supplied.
 *
 * A plain export (no flags) of a wiki with zero collections is NOT an error: it
 * returns `{ included: [], errors: [] }`.
 */
export function resolveCollectionSelection(all: string[], sel: CollectionSelection = {}): CollectionSelectionResult {
  const filter = sel.filter ?? [];
  const exclude = sel.exclude ?? [];
  const errors: string[] = [];

  for (const p of filter) {
    if (!all.some((n) => globToRegExp(p).test(n))) errors.push(`--filter "${p}" matched no collections`);
  }
  for (const p of exclude) {
    if (!all.some((n) => globToRegExp(p).test(n))) errors.push(`--exclude "${p}" matched no collections`);
  }

  let included = filter.length > 0 ? all.filter((n) => matchesAny(n, filter)) : [...all];
  included = included.filter((n) => !matchesAny(n, exclude));

  // Only an EMPTY selection produced by a caller-supplied --filter/--exclude is an
  // error. A plain export of a wiki that simply has no collections yet is valid and
  // must return an empty include list, not abort.
  const hasSelectionFlags = filter.length > 0 || exclude.length > 0;
  if (included.length === 0 && hasSelectionFlags && errors.length === 0) {
    errors.push('no collections left to export after applying --filter/--exclude');
  }
  return { included, errors };
}
