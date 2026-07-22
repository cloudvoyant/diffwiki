/**
 * Known plugin catalog.
 *
 * A built-in directory of official diffwiki plugins that users can install.
 * This is discovery only -- installing goes through `installPlugin(spec)`.
 *
 * @module
 */

import type { PluginKind } from '../types';

/**
 * A plugin diffwiki knows about and can recommend — the "app store" catalog.
 * Discovery only; installing still goes through `installPlugin(spec)`.
 */
export interface KnownPlugin {
  name: string;
  kind: PluginKind;
  /** The argument for `diffwiki plugin install <spec>` (the npm package name). */
  spec: string;
  description: string;
  /** External tool the plugin drives, shown as a prerequisite hint. */
  requires?: string;
}

/** Built-in catalog of the official diffwiki plugins. */
export const KNOWN_PLUGINS: readonly KnownPlugin[] = [
  {
    name: 'diffwiki-qmd',
    kind: 'search',
    spec: 'diffwiki-qmd',
    description: 'Local hybrid search — keyword, semantic, and reranked hybrid via the qmd CLI',
    requires: 'qmd (npm i -g @tobilu/qmd)',
  },
  {
    name: 'diffwiki-ripgrep',
    kind: 'search',
    spec: 'diffwiki-ripgrep',
    description: 'Instant literal/regex search via ripgrep — no index, no models',
    requires: 'rg (ripgrep)',
  },
];

/** Return a copy of the known/official plugins available to install. */
export function listAvailablePlugins(): KnownPlugin[] {
  return [...KNOWN_PLUGINS];
}
