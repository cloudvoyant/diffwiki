/**
 * diffwiki-core -- public API.
 *
 * This barrel exports the complete host-side API for diffwiki. Plugin internals
 * (invoke, wire protocol) are NOT exported from this entry point. The plugin
 * authoring SDK is available via the `diffwiki-core/plugin` subpath export.
 *
 * @module
 */

// Core types
export * from './types';
export * from './errors';

// Configuration and paths
export * from './paths';
export * from './config';

// Registry and collections
export * from './registry';
export * from './slugify';
export * from './frontmatter';
export * from './collections';
export * from './articles';
export * from './repo';
// Git identity + external collections helpers, and site builders (used by the
// wiki app's server functions AND the static exporter)
export * from './git';
export * from './site';
export * from './select';

// Search
export { search, query, nativeSearch, resolveDefaultSearchMode } from './query';
export type { SearchOutcome } from './query';
// Pure BM25 scorer + index types (also exposed browser-side via `diffwiki-core/bm25`)
export { tokenize, rankDocs } from './bm25';
export type { RankableFields, SearchDoc } from './bm25';
// Static search index (consumed by the exporter to build search-index.json)
export * from './search';

// Diagnostics
export { doctor } from './doctor';

// Logging (LogTape wrappers; core NEVER configures — apps do)
export { getLogger, resolveLogLevel } from './logger';
export type { DiffwikiLogLevel } from './logger';

// Content rendering and browsing
export * from './browse';
export * from './render';

// Plugin management (curated -- no internal helpers)
export {
  loadSearchProvider,
  listSearchModes,
  installPlugin,
  registerPlugin,
  removePlugin,
  listPlugins,
  ensurePluginRoot,
  emitPluginEvent,
  listAvailablePlugins,
  readPluginRegistry,
  writePluginRegistry,
  upsertPlugin,
  deregisterPlugin,
  listEnabledPlugins,
  findEnabledPlugin,
  findPluginRecord,
} from './plugins/index';
export type { KnownPlugin, InstallOutcome, SetupOutcome, SetupStep } from './plugins/index';
