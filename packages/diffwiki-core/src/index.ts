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

// Search
export { search, query, nativeSearch, resolveDefaultSearchMode } from './query';
export type { SearchOutcome } from './query';

// Diagnostics
export { doctor } from './doctor';

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
export type { KnownPlugin } from './plugins/index';
