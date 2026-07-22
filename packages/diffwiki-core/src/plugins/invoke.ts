/**
 * One-shot plugin invocation.
 *
 * Spawns a plugin subprocess, writes a single JSON request to stdin (then
 * closes stdin), reads the JSON response from stdout, and lets the process
 * exit naturally. This replaces the old persistent JSON-lines client that
 * maintained a long-lived child process with pending-map/id-correlation.
 *
 * Progress/diagnostic logs from the plugin go to STDERR and are not parsed
 * by the host. Only the single JSON line on stdout is consumed.
 *
 * @module
 */

import { spawn } from 'node:child_process';

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
 * @param opts - Optional timeout override.
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

  return new Promise<T>((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

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
    });

    child.on('error', (err: Error) => {
      settle(() => reject(new Error(`plugin spawn failed: ${err.message}`)));
    });

    child.on('close', (code: number | null) => {
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
