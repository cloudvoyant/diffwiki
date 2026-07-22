/**
 * Plugin subsystem -- public API re-exports.
 *
 * This barrel re-exports only the symbols that constitute the public host-side
 * plugin API. Internal helpers (invokePlugin, registry file I/O, wire codecs)
 * are deliberately NOT exported here.
 *
 * @module
 */

export { loadSearchProvider, listSearchModes } from './loader';
export { installPlugin, registerPlugin, removePlugin, listPlugins, ensurePluginRoot } from './manager';
export { emitPluginEvent } from './events';
export { listAvailablePlugins, type KnownPlugin } from './catalog';
export {
  readPluginRegistry,
  writePluginRegistry,
  upsertPlugin,
  deregisterPlugin,
  listEnabledPlugins,
  findEnabledPlugin,
  findPluginRecord,
} from './registry';
