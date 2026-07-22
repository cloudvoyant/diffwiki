/**
 * One-shot plugin invocation.
 *
 * Spawns a plugin subprocess, writes a single JSON request to stdin (then
 * closes stdin), reads the JSON response from stdout, and lets the process
 * exit naturally. This replaces the old persistent JSON-lines client that
 * maintained a long-lived child process with pending-map/id-correlation.
 *
 * Progress/diagnostic logs from the plugin go to STDERR as structured
 * `{log:{level,message}}` JSON lines. The host parses stderr line-by-line as it
 * arrives and forwards each such line to a LogTape logger scoped by the plugin
 * name (`['diffwiki', 'plugin', <name>]` via {@link getLogger}), so plugin
 * diagnostics surface on success — not just on failure. The RAW stderr is still
 * accumulated for the on-error context. Only the single JSON line on stdout is
 * consumed as the response.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { getLogger } from '../logger';

/**
 * The LogTape Logger method names, keyed by the level a plugin reports. LogTape
 * 2.x names the level `warning`, but its Logger method is `warn`, so the wire
 * level `warn` and `warning` both map to `.warn`. Unknown levels map to `info`.
 */
const LEVEL_METHOD = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
} as const satisfies Record<string, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'>;

/** A structured log line a plugin may emit on stderr. */
interface WireLog {
  log?: { level?: unknown; message?: unknown };
}

/** Default timeout for most ops (describe, health, event). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Timeout for search ops (may trigger an incremental re-embed). */
export const SEARCH_TIMEOUT_MS = 120_000;

/** Timeout for long ops (setup, index -- model download + full embed). */
export const LONG_TIMEOUT_MS = 1_800_000;

/** Options for `invokePlugin`. */
export interface InvokeOptions {
  /** Timeout in milliseconds. Defaults to `DEFAULT_TIMEOUT_MS` (30s). */
  timeoutMs?: number;
  /**
   * Plugin name used as the log scope when forwarding the child's `{log}` lines.
   * Defaults to the basename of the spawned binary (`command[1]` or `command[0]`).
   */
  name?: string;
}

interface WireResponse {
  ok: boolean;
  result?: unknown;
  error?: { message?: string };
}

/**
 * Invoke a single operation on a plugin subprocess.
 *
 * Spawns the plugin using `command` (an argv array), writes `{op, params}` as
 * a single JSON line to stdin, closes stdin, then reads one JSON response line
 * from stdout. The process exits after responding.
 *
 * @param command - The argv to spawn (e.g. `['node', '/path/to/bin.js']`).
 * @param op - The operation name (e.g. `'describe'`, `'search'`, `'index'`).
 * @param params - The operation parameters.
 * @param opts - Optional timeout override and log scope (`name`).
 * @returns The `result` field from the plugin's response.
 * @throws If the plugin exits with an error, times out, or returns `ok: false`.
 */
export async function invokePlugin<T = unknown>(
  command: string[],
  op: string,
  params: Record<string, unknown>,
  opts?: InvokeOptions,
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scope = opts?.name ?? basename(command[1] ?? command[0] ?? 'plugin');

  return new Promise<T>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stderrLine = '';
    let settled = false;

    // Forward a single stderr line that is a `{log:{level,message}}` object to a
    // LogTape logger scoped by the plugin name (`['plugin', <name>]`). An
    // unknown/absent level maps to `info`. Non-JSON / non-log lines are ignored
    // here (they remain in the accumulated raw stderr for on-error context).
    const forwardLog = (line: string): void => {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('{')) return;
      let parsed: WireLog;
      try {
        parsed = JSON.parse(trimmedLine) as WireLog;
      } catch {
        return;
      }
      const entry = parsed.log;
      if (!entry || typeof entry.message !== 'string') return;
      const rawLevel = typeof entry.level === 'string' ? entry.level.toLowerCase() : '';
      const method = LEVEL_METHOD[rawLevel as keyof typeof LEVEL_METHOD] ?? 'info';
      getLogger(['plugin', scope])[method](entry.message);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`plugin "${op}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      // Split the accumulated buffer on newlines, forwarding each complete line
      // as it arrives and holding the trailing partial line for the next chunk.
      stderrLine += chunk;
      let nl: number;
      while ((nl = stderrLine.indexOf('\n')) !== -1) {
        forwardLog(stderrLine.slice(0, nl));
        stderrLine = stderrLine.slice(nl + 1);
      }
    });

    child.on('error', (err: Error) => {
      settle(() => reject(new Error(`plugin spawn failed: ${err.message}`)));
    });

    child.on('close', (code: number | null) => {
      // Forward any trailing stderr line the child emitted without a newline.
      if (stderrLine.length > 0) {
        forwardLog(stderrLine);
        stderrLine = '';
      }
      settle(() => {
        const trimmed = stdout.trim();
        if (!trimmed) {
          reject(
            new Error(`plugin "${op}" produced no output (exit ${code})${stderr ? ': ' + stderr.slice(0, 500) : ''}`),
          );
          return;
        }

        let response: WireResponse;
        try {
          response = JSON.parse(trimmed) as WireResponse;
        } catch {
          reject(new Error(`plugin "${op}" returned invalid JSON: ${trimmed.slice(0, 200)}`));
          return;
        }

        if (response.ok) {
          resolve(response.result as T);
        } else {
          const message =
            typeof response.error?.message === 'string' ? response.error.message : `plugin "${op}" failed`;
          reject(new Error(message));
        }
      });
    });

    // Write the request and close stdin so the plugin knows input is complete.
    const request = JSON.stringify({ op, params });
    child.stdin.write(request + '\n', (err) => {
      if (err && !settled) {
        settle(() => reject(new Error(`failed to write to plugin stdin: ${err.message}`)));
        return;
      }
      child.stdin.end();
    });
  });
}
