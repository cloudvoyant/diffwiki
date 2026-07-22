/**
 * CLI-side LogTape configuration (the "application" half of the
 * library-vs-app pattern). diffwiki-core stays silent until this runs.
 *
 * Two sinks are installed:
 *  - `stderr` — a tiny custom sink that writes formatted lines to
 *    **`process.stderr`**. This is CRITICAL: `process.stdout` carries the CLI's
 *    machine-readable data (JSON, query results) that e2e tests parse, so logs
 *    must NEVER touch stdout. LogTape's built-in `getConsoleSink()` routes
 *    info/debug to stdout via `console.*`, so we deliberately do NOT use it.
 *  - `file` — a rotating file sink at `~/.diffwiki/logs/diffwiki.log`, capturing
 *    the full `['diffwiki']` tree at the resolved level for after-the-fact
 *    debugging.
 *
 * The stderr sink's verbosity is chosen at startup from (in order) `-v/--verbose`
 * (→ `debug`), `--log <level>`, then `DIFFWIKI_LOG` (via `resolveLogLevel`).
 * These are read straight from `process.argv`/env — not a Commander `preAction`
 * hook — because configuration must happen before any startup log is emitted,
 * and a hook fires too late for those.
 *
 * Everything outside the `['diffwiki']` category (e.g. LogTape's own meta logs)
 * is silenced by a catch-all logger pinned to `fatal` with no sinks.
 *
 * @module
 */

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureSync, getConfig, type LogRecord } from '@logtape/logtape';
import { getRotatingFileSink } from '@logtape/file';
import { resolveLogLevel, type DiffwikiLogLevel } from 'diffwiki-core';

/** Guard so a second `configureCliLogging()` call (e.g. in tests) is a no-op. */
let configured = false;

/** Root of diffwiki state, honoring `DIFFWIKI_HOME` (kept in sync with core). */
function diffwikiHome(): string {
  const override = process.env.DIFFWIKI_HOME;
  return override && override.length > 0 ? override : path.join(os.homedir(), '.diffwiki');
}

/**
 * Choose the stderr sink's lowest level from CLI flags then the environment.
 *
 * Precedence: `-v`/`--verbose` (→ `debug`) beats `--log <level>` beats
 * `DIFFWIKI_LOG` (via {@link resolveLogLevel}, default `warning`). Reads raw
 * `argv` so the level is known before Commander parses.
 */
function resolveCliLevel(argv: readonly string[]): DiffwikiLogLevel {
  if (argv.includes('-v') || argv.includes('--verbose')) return 'debug';
  const flagIdx = argv.indexOf('--log');
  const flagValue = flagIdx !== -1 ? argv[flagIdx + 1] : undefined;
  return resolveLogLevel(flagValue ? { DIFFWIKI_LOG: flagValue } : process.env);
}

/** Format a LogTape record as `LEVEL [category] message` for a single stderr/file line. */
function formatLine(record: LogRecord): string {
  const category = record.category.join('.');
  const message = record.message.map((part) => (typeof part === 'string' ? part : String(part))).join('');
  return `${record.level.toUpperCase()} [${category}] ${message}`;
}

/**
 * Configure LogTape for the CLI. Idempotent (guarded), safe to call at program
 * startup. Creates `~/.diffwiki/logs/` before installing the rotating file sink.
 *
 * @param argv - The process argv (defaults to `process.argv`), scanned for
 *   `-v`/`--verbose`/`--log` to pick the stderr verbosity.
 */
export function configureCliLogging(argv: readonly string[] = process.argv): void {
  // `getConfig()` guards against LogTape already being configured elsewhere in
  // the runtime (its config is global and outlives this module's `configured`
  // flag); a second `configureSync` would throw `ConfigError: Already configured`.
  if (configured || getConfig() != null) return;
  configured = true;

  const level = resolveCliLevel(argv);
  const logsDir = path.join(diffwikiHome(), 'logs');
  mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, 'diffwiki.log');

  // Custom stderr sink — MUST target process.stderr, never stdout.
  const stderrSink = (record: LogRecord): void => {
    process.stderr.write(formatLine(record) + '\n');
  };

  configureSync({
    sinks: {
      stderr: stderrSink,
      file: getRotatingFileSink(logFile),
    },
    loggers: [
      { category: ['diffwiki'], lowestLevel: level, sinks: ['stderr', 'file'] },
      // Silence everything else (incl. LogTape meta logs).
      { category: [], lowestLevel: 'fatal', sinks: [] },
    ],
  });
}
