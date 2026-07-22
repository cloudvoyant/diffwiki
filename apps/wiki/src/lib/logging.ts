/**
 * Web-app LogTape configuration (the "application" half of the
 * library-vs-app pattern). diffwiki-core and the plugin SDK stay silent until
 * this runs, so importing it once wires up their `getLogger` calls.
 *
 * This entry is isomorphic: on the server it logs to the server console, and in
 * the browser it logs to the devtools console — a `getConsoleSink()` is fine in
 * both (unlike the CLI, the web app has no stdout-data contract). It is imported
 * by `router.tsx` and guarded by a module-level flag so repeated imports /
 * SSR-vs-client double-evaluation configure LogTape at most once.
 *
 * @module
 */

import { configureSync, getConsoleSink, getConfig } from '@logtape/logtape';

/**
 * Web log level — read from Vite's build-time env (`VITE_DIFFWIKI_LOG`), default
 * `warning`. This module deliberately does NOT import from `diffwiki-core`: that
 * barrel pulls in the Node-only plugin subsystem (`child_process`), which cannot
 * be bundled into the browser client. Core's own `getLogger` calls share this
 * same LogTape global once configured, so server-side core logs still route.
 */
type WebLogLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';
const WEB_LOG_LEVEL: WebLogLevel = (import.meta.env?.VITE_DIFFWIKI_LOG as WebLogLevel) || 'warning';

/** Fast-path guard for repeat calls within the same module instance. */
let configured = false;

/**
 * Configure LogTape for the web app if it has not been configured yet.
 * Idempotent and side-effect-light: a no-op on every call after the first.
 *
 * The `getConfig()` check is load-bearing, not just the local flag: LogTape
 * keeps its configuration in its own module's global state, which SURVIVES
 * Vite's dev SSR module re-evaluation — whereas the module-level `configured`
 * flag resets to `false` on every re-eval. Without the `getConfig()` guard, a
 * re-eval would call `configureSync` a second time and throw
 * `ConfigError: Already configured`, 500-ing every route until the dev server
 * is restarted.
 */
export function configureWebLogging(): void {
  if (configured || getConfig() != null) return;
  configured = true;

  configureSync({
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: ['diffwiki'], lowestLevel: WEB_LOG_LEVEL, sinks: ['console'] },
      // Silence LogTape's own meta logs.
      { category: [], lowestLevel: 'fatal', sinks: [] },
    ],
  });
}

// Configure on first import.
configureWebLogging();
