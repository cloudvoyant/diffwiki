/**
 * Typed qmd CLI operations.
 *
 * Every interaction with the `qmd` binary goes through a named function here, so
 * the rest of the plugin never assembles raw `qmd` argv arrays. This isolates
 * the CLI's surface (subcommands, flag names, the shared `--index`) in one place:
 * callers express intent (`update`, `embed`, `searchJson`), not command lines.
 *
 * These are thin wrappers over {@link runQmd} / {@link runQmdJson} from `qmd.ts`
 * (which own binary resolution and process execution); this module owns the
 * command vocabulary.
 *
 * @module
 */

import { INDEX, runQmd, runQmdJson } from './qmd.js';
import type { RunProcessOptions } from 'diffwiki-core/plugin';
import type { QmdRow, SearchExpansion } from './types.js';

/** Map a diffwiki search type to the qmd subcommand that serves it. */
export function searchSubcommand(type: string | undefined): string {
  switch (type) {
    case 'semantic':
      return 'vsearch';
    case 'hybrid':
      return 'query';
    case 'keyword':
    default:
      return 'search';
  }
}

/** `qmd collection remove <name>` — drop a collection's registration. */
export function collectionRemove(name: string, opts?: RunProcessOptions): Promise<string> {
  return runQmd(['collection', 'remove', name, '--index', INDEX], opts);
}

/** `qmd collection add <path> --name <name>` — register a collection directory. */
export function collectionAdd(path: string, name: string, opts?: RunProcessOptions): Promise<string> {
  return runQmd(['collection', 'add', path, '--name', name, '--index', INDEX], opts);
}

/** `qmd context add <uri> <text>` — attach supplemental ranking context to a file. */
export function contextAdd(uri: string, text: string, opts?: RunProcessOptions): Promise<string> {
  return runQmd(['context', 'add', uri, text, '--index', INDEX], opts);
}

/** `qmd update` — reindex; scoped to one collection when `collection` is given. */
export function update(opts?: RunProcessOptions, collection?: string): Promise<string> {
  const args = ['update', '--index', INDEX];
  if (collection && collection.length > 0) args.push('-c', collection);
  return runQmd(args, opts);
}

/** `qmd status` — raw stdout (no `--format json` support); parse with `parseQmdStatus`. */
export function statusRaw(opts?: RunProcessOptions): Promise<string> {
  return runQmd(['status', '--index', INDEX], opts);
}

/** `qmd embed` — build embeddings for docs that need them. */
export function embed(opts?: RunProcessOptions): Promise<string> {
  return runQmd(['embed', '--index', INDEX], opts);
}

/**
 * Run a cold `qmd <sub> --format json` search and return the parsed rows. Maps
 * the diffwiki search `type` to its subcommand and applies the collection filter.
 */
export function searchJson(
  type: string,
  params: { term: string; limit: number; collection?: string },
  opts?: RunProcessOptions,
): Promise<QmdRow[]> {
  const args = [searchSubcommand(type), '--index', INDEX, '--format', 'json', '-n', String(params.limit)];
  if (params.collection && params.collection.length > 0) {
    args.push('-c', params.collection);
  }
  // `--` terminates flag parsing so a term starting with `-` isn't read as a qmd flag.
  args.push('--', params.term);
  return runQmdJson<QmdRow[]>(args, opts);
}

/**
 * Cold structured search: `qmd query` over caller-supplied variants (a
 * `lex:/vec:/hyde:` query document) instead of the engine's own expansion. Used
 * when an upstream LLM already expanded the query. `intent` rides along for
 * ranking. Mirrors the warm MCP `searches` path so cold/warm stay consistent.
 */
export function searchStructuredJson(
  expansions: readonly SearchExpansion[],
  params: { limit: number; collection?: string; intent?: string },
  opts?: RunProcessOptions,
): Promise<QmdRow[]> {
  // A qmd query document: an optional leading `intent:` line, then one typed
  // `lex:/vec:/hyde:` line per variant.
  const lines = expansions.map((e) => `${e.type}: ${e.query}`);
  if (params.intent && params.intent.length > 0) {
    lines.unshift(`intent: ${params.intent}`);
  }
  const doc = lines.join('\n');
  const args = ['query', '--index', INDEX, '--format', 'json', '-n', String(params.limit)];
  if (params.collection && params.collection.length > 0) {
    args.push('-c', params.collection);
  }
  args.push('--', doc);
  return runQmdJson<QmdRow[]>(args, opts);
}
