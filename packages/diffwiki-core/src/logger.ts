/**
 * Centralized logging for diffwiki host code, built on LogTape.
 *
 * diffwiki-core (and the plugin SDK) are LIBRARIES: they obtain loggers via
 * {@link getLogger} and emit records, but they NEVER call LogTape's
 * `configure()`/`configureSync()`. Per the LogTape library-vs-app pattern, a
 * library stays silent until the surrounding APPLICATION (the CLI or the web
 * app) installs sinks. `getLogger` called before any `configure` is a safe
 * no-op, so importing this module has no side effects.
 *
 * All diffwiki loggers live under the `['diffwiki', ...]` category so an app can
 * route the whole tree with a single logger config entry. Plugin diagnostics
 * are forwarded under `['diffwiki', 'plugin', <name>]` (see `plugins/host.ts`).
 *
 * [DEVIATION] The task brief lists the level name `warn`, but the installed
 * `@logtape/logtape` (2.2.4) names that level `warning` (levels are
 * `trace|debug|info|warning|error|fatal`). We follow the installed types:
 * {@link DiffwikiLogLevel} uses `warning`, and {@link resolveLogLevel} defaults
 * to `warning`. Note LogTape's Logger METHOD for that level is still `.warn()`.
 *
 * @module
 */

import { getLogger as logtapeGetLogger, type LogLevel, type Logger } from '@logtape/logtape';

/**
 * A diffwiki log level. Identical to LogTape's `LogLevel`
 * (`trace|debug|info|warning|error|fatal`); re-exported so host and app code can
 * refer to it without importing LogTape directly.
 */
export type DiffwikiLogLevel = LogLevel;

/** The valid level names, used to validate the `DIFFWIKI_LOG` env var. */
const LEVELS: readonly DiffwikiLogLevel[] = ['trace', 'debug', 'info', 'warning', 'error', 'fatal'];

/** The documented default level when `DIFFWIKI_LOG` is unset or invalid. */
const DEFAULT_LEVEL: DiffwikiLogLevel = 'warning';

/**
 * Get a diffwiki logger under the shared `['diffwiki', ...]` category root.
 *
 * This is a thin wrapper over LogTape's `getLogger`. It does NOT configure
 * LogTape — libraries stay silent until an app calls `configure()`. Passing a
 * string scope is sugar for a single-element category array.
 *
 * @param scope - A scope name (e.g. `'query'`) or a nested category path
 *   (e.g. `['plugin', 'diffwiki-qmd']`).
 * @returns A LogTape {@link Logger} under `['diffwiki', ...scope]`.
 */
export function getLogger(scope: string | string[]): Logger {
  const parts = Array.isArray(scope) ? scope : [scope];
  return logtapeGetLogger(['diffwiki', ...parts]);
}

/**
 * Resolve the diffwiki log level from the environment.
 *
 * Reads `DIFFWIKI_LOG` (one of `trace|debug|info|warning|error|fatal`, case
 * insensitive) and returns it, falling back to the documented default
 * (`warning`) when unset or unrecognized. Apps use this to pick the app-level
 * sink's `lowestLevel` at startup.
 *
 * @param env - The environment to read (defaults to `process.env`). Injectable
 *   for tests.
 * @returns The resolved {@link DiffwikiLogLevel}.
 */
export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): DiffwikiLogLevel {
  const raw = (env.DIFFWIKI_LOG ?? '').toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as DiffwikiLogLevel) : DEFAULT_LEVEL;
}
