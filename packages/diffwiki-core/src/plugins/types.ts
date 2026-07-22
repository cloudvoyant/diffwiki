/**
 * Wire-protocol and SDK types shared by the plugin authoring SDK (`sdk.ts`) and
 * re-exported to plugin authors via the `diffwiki-core/plugin` subpath.
 *
 * @module
 */

/** Log severity levels for plugin diagnostic messages. */
export type LogLevel = 'info' | 'warn' | 'error';

/** A logging function that plugins use to emit diagnostic messages to stderr. */
export type PluginLogFn = (level: LogLevel, message: string) => void;

/** A wire-format collection as received in handler params. */
export interface WireCollection {
  name: string;
  path: string;
}

/** Diagnostic entry returned by the health handler. */
export interface WireDiagnostic {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

/** Readiness details returned by the health handler. */
export interface WireReadiness {
  toolInstalled: boolean;
  modelsPresent: boolean;
  indexBuilt: boolean;
  docsIndexed: number;
  embeddingsPending: number;
  firstSearchCost: 'instant' | 'model-load' | 'model-download';
}

/** A single search hit returned by the search handler. */
export interface SearchHandlerHit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  score?: number;
  docid?: string;
  tags?: string[];
}

/** Result shape returned by the search handler. */
export interface SearchHandlerResult {
  hits: SearchHandlerHit[];
}

/** Result shape returned by the index handler. */
export interface IndexHandlerResult {
  indexed: number;
}

/** Result shape returned by the health handler. */
export interface HealthHandlerResult {
  ready: boolean;
  readiness?: WireReadiness;
  diagnostics: WireDiagnostic[];
}

/** Result shape returned by the setup handler. */
export interface SetupHandlerResult {
  ready: boolean;
  steps?: Array<{ step: string; ok: boolean; message?: string }>;
}

/** Result shape returned by the onEvent handler. */
export interface EventHandlerResult {
  accepted: boolean;
}

/** Parameters passed to the search handler. */
export interface SearchParams {
  term: string;
  collections: WireCollection[];
  collection?: string;
  type?: string;
  limit?: number;
}

/** Parameters passed to the index handler. */
export interface IndexParams {
  collections: WireCollection[];
  embed?: boolean;
}

/** Parameters passed to the setup handler. */
export interface SetupParams {
  collections: WireCollection[];
  embed?: boolean;
  prefetchModels?: boolean;
}

/** Parameters passed to the onEvent handler. */
export interface EventParams {
  event: string;
  collection: WireCollection;
  relPath?: string;
  collections: WireCollection[];
}

/** Parameters passed to the health handler. */
export interface HealthParams {
  collections: WireCollection[];
}

/** Plugin capabilities advertised during describe. */
export interface PluginCapabilities {
  searchTypes: string[];
  collectionFilter: boolean;
  events: boolean;
}

/**
 * An external executable a plugin needs at runtime (e.g. `qmd`, `rg`).
 *
 * Declaring a dependency lets the plugin resolve the binary uniformly and lets
 * `setup`/`health` report it. When `npm` is set, the package is expected to be a
 * regular dependency in the plugin's own `package.json`, so `diffwiki plugin
 * install` pulls it transitively and {@link ResolvedDependency} finds its bin in
 * the plugin's `node_modules` — no global install required.
 */
export interface PluginDependency {
  /** The executable name, e.g. `'qmd'` or `'rg'`. */
  command: string;
  /** npm package that provides the executable; when set, the local bin is preferred over PATH. */
  npm?: string;
  /** Human-facing manual install hint, shown when the dependency is unresolved. */
  hint?: string;
}

/**
 * The outcome of resolving a {@link PluginDependency}: the argv prefix to invoke
 * it, plus where it was found. `command` is null when unresolved.
 */
export interface ResolvedDependency {
  dependency: PluginDependency;
  /** Argv prefix to spawn the tool, or null if unresolved. */
  command: string[] | null;
  /** How it resolved: the npm-provided local bin, the system PATH, or nowhere. */
  source: 'npm' | 'path' | 'missing';
}

/** The handler functions a plugin provides. */
export interface PluginHandlers {
  /** Handle a search request. Required for search plugins. */
  search: (params: SearchParams, log: PluginLogFn) => Promise<SearchHandlerResult> | SearchHandlerResult;
  /** Handle a reindex request. Optional -- defaults to `{ indexed: 0 }`. */
  index?: (params: IndexParams, log: PluginLogFn) => Promise<IndexHandlerResult> | IndexHandlerResult;
  /** Handle an initial setup/provisioning request. Optional -- defaults to `{ ready: true }`. */
  setup?: (params: SetupParams, log: PluginLogFn) => Promise<SetupHandlerResult> | SetupHandlerResult;
  /** Handle a lifecycle event (article/collection add/update/remove). Optional. */
  onEvent?: (params: EventParams, log: PluginLogFn) => Promise<EventHandlerResult> | EventHandlerResult;
  /** Report plugin health and readiness. Optional. */
  health?: (params: HealthParams, log: PluginLogFn) => Promise<HealthHandlerResult> | HealthHandlerResult;
}

/** The definition object passed to `definePlugin()`. */
export interface PluginDefinition {
  /** Plugin name (must match the name used in `diffwiki plugin register`). */
  name: string;
  /** Plugin kind. Currently only `'search'` is supported. */
  kind: 'search';
  /** Semantic version string. */
  version?: string;
  /** Plugin capabilities advertised to the host. */
  capabilities: PluginCapabilities;
  /** External executables the plugin needs. Reported via `describe` and resolvable via {@link ResolvedDependency}. */
  dependencies?: PluginDependency[];
  /** Handler functions for each operation. */
  handlers: PluginHandlers;
}

/** The object returned by `definePlugin()`. Call `.run()` to serve one request. */
export interface DefinedPlugin {
  /** The plugin definition. */
  definition: PluginDefinition;
  /**
   * Read one JSON request from stdin, dispatch to the matching handler, write
   * the JSON response to stdout, and exit. Exit code 0 on success, 1 on
   * handler error. Logs go to stderr.
   */
  run: () => void;
}

/** Options for `runProcess` and `runProcessJson`. */
export interface RunProcessOptions {
  /** Environment variables for the child process. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Timeout in milliseconds. No timeout by default. */
  timeout?: number;
}
