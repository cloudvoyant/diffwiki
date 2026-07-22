/**
 * `diffwiki-core/plugin` subpath entry — re-exports the plugin authoring SDK.
 *
 * The SDK implementation lives in `./plugins/sdk`; this barrel keeps the
 * published `dist/plugin.*` build entry (and its public name) stable.
 *
 * @module
 */

export * from './plugins/sdk';
