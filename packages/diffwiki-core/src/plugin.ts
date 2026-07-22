/**
 * diffwiki plugin authoring SDK.
 *
 * This module is the sole public surface for plugin authors. Import it via the
 * `diffwiki-core/plugin` subpath export. It is deliberately self-contained: it
 * does NOT import any host-side code (fs, registry, query, paths) so plugin
 * binaries stay slim and free of host coupling.
 *
 * Usage:
 *   import { definePlugin, runProcess, commandExists } from 'diffwiki-core/plugin';
 *   definePlugin({ name: 'my-plugin', kind: 'search', ... }).run();
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Authoring types
// ---------------------------------------------------------------------------

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

/** The handler functions a plugin provides. */
export interface PluginHandlers {
  /** Handle a search request. Required for search plugins. */
  search: (params: SearchParams, log: PluginLogFn) => Promise<SearchHandlerResult> | SearchHandlerResult;
  /** Handle a reindex request. Optional -- defaults to `{ indexed: 0 }`. */
  index?: (params: IndexParams, log: PluginLogFn) => Promise<IndexHandlerResult> | IndexHandlerResult;
  /** Handle an initial setup/provisioning request. Optional -- defaults to `{ ready: true }`. */
  setup?: (params: SetupParams, log: PluginLogFn) => Promise<SetupHandlerResult> | SetupHandlerResult;
  /** Handle a lifecycle event (article created/updated/removed, collection added/removed). Optional. */
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

// ---------------------------------------------------------------------------
// Wire protocol types (internal to the SDK, not exported)
// ---------------------------------------------------------------------------

interface WireRequest {
  op: string;
  params?: Record<string, unknown>;
}

interface WireResponseOk {
  ok: true;
  result: unknown;
}

interface WireResponseErr {
  ok: false;
  error: { message: string };
}

// ---------------------------------------------------------------------------
// Shared subprocess utilities
// ---------------------------------------------------------------------------

/** Options for `runProcess` and `runProcessJson`. */
export interface RunProcessOptions {
  /** Environment variables for the child process. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Timeout in milliseconds. No timeout by default. */
  timeout?: number;
}

/**
 * Run an external command and return its stdout and stderr.
 *
 * A promisified wrapper around `child_process.execFile`. Plugins that drive
 * external CLI tools (e.g. `qmd`, `rg`) use this instead of implementing their
 * own exec wrappers.
 *
 * @param file - The executable to run.
 * @param args - Command-line arguments.
 * @param opts - Optional environment and timeout.
 * @returns An object with `stdout` and `stderr` strings.
 */
export async function runProcess(
  file: string,
  args: readonly string[],
  opts?: RunProcessOptions,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args as string[], {
    env: opts?.env,
    timeout: opts?.timeout,
    maxBuffer: 50 * 1024 * 1024, // 50 MB — generous for large JSON output
  });
  return { stdout, stderr };
}

/**
 * Run an external command and JSON-parse its stdout.
 *
 * Convenience wrapper around `runProcess` for tools that produce JSON output
 * (e.g. `qmd --format json`, `rg --json`).
 *
 * @param file - The executable to run.
 * @param args - Command-line arguments.
 * @param opts - Optional environment and timeout.
 * @returns The parsed JSON value.
 * @throws If the command fails or stdout is not valid JSON.
 */
export async function runProcessJson<T>(file: string, args: readonly string[], opts?: RunProcessOptions): Promise<T> {
  const { stdout } = await runProcess(file, args, opts);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${file} ${args.join(' ')} did not return valid JSON: ${stdout.slice(0, 200)}`);
  }
}

/**
 * Check whether a command exists on PATH.
 *
 * Attempts to run `<name> --version`. Returns `true` if the command exits
 * successfully (exit 0), `false` otherwise. Never throws.
 *
 * @param name - The command name to probe (e.g. `'qmd'`, `'rg'`).
 * @returns `true` if the command is available.
 */
export async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(name, ['--version']);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// definePlugin
// ---------------------------------------------------------------------------

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Define a diffwiki plugin.
 *
 * This is the required entry point for all diffwiki plugins. It accepts a
 * `PluginDefinition` describing the plugin's metadata, capabilities, and
 * handler functions, and returns a `DefinedPlugin` whose `.run()` method
 * serves one request over stdin/stdout then exits.
 *
 * Example:
 * ```ts
 * import { definePlugin, commandExists } from 'diffwiki-core/plugin';
 *
 * definePlugin({
 *   name: 'my-plugin',
 *   kind: 'search',
 *   capabilities: { searchTypes: ['text'], collectionFilter: true, events: false },
 *   handlers: {
 *     async search(params, log) {
 *       return { hits: [] };
 *     },
 *   },
 * }).run();
 * ```
 *
 * @param def - The plugin definition.
 * @returns A `DefinedPlugin` with a `.run()` method.
 */
export function definePlugin(def: PluginDefinition): DefinedPlugin {
  const { name, kind, version, capabilities, handlers } = def;

  const describeResult = {
    name,
    kind,
    version,
    capabilities: {
      searchTypes: capabilities.searchTypes,
      collectionFilter: capabilities.collectionFilter,
      events: capabilities.events,
    },
  };

  async function dispatch(op: string, params: Record<string, unknown>, log: PluginLogFn): Promise<unknown> {
    switch (op) {
      case 'describe':
        return describeResult;

      case 'search':
        return handlers.search(params as unknown as SearchParams, log);

      case 'index':
        if (handlers.index) return handlers.index(params as unknown as IndexParams, log);
        return { indexed: 0 };

      case 'setup':
        if (handlers.setup) return handlers.setup(params as unknown as SetupParams, log);
        return { ready: true };

      case 'event':
        if (handlers.onEvent) return handlers.onEvent(params as unknown as EventParams, log);
        return { accepted: true };

      case 'health':
        if (handlers.health) return handlers.health(params as unknown as HealthParams, log);
        return { ready: true, diagnostics: [] };

      default:
        throw new Error(`unknown op: ${op}`);
    }
  }

  function run(): void {
    const log: PluginLogFn = (level, message) => {
      process.stderr.write(JSON.stringify({ log: { level, message } }) + '\n');
    };

    let buffer = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
    });

    process.stdin.on('end', () => {
      const line = buffer.trim();
      if (!line) {
        process.stderr.write(`${name}: no input received on stdin\n`);
        process.exit(1);
        return;
      }

      let req: WireRequest;
      try {
        req = JSON.parse(line) as WireRequest;
      } catch {
        process.stderr.write(`${name}: malformed JSON on stdin: ${line.slice(0, 200)}\n`);
        process.exit(1);
        return;
      }

      dispatch(req.op, req.params ?? {}, log)
        .then((result) => {
          const response: WireResponseOk = { ok: true, result };
          process.stdout.write(JSON.stringify(response) + '\n');
          process.exit(0);
        })
        .catch((err: unknown) => {
          const response: WireResponseErr = {
            ok: false,
            error: { message: toMessage(err) },
          };
          process.stdout.write(JSON.stringify(response) + '\n');
          process.exit(1);
        });
    });
  }

  return { definition: def, run };
}
