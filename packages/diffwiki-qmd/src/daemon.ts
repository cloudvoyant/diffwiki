/**
 * qmd warm-daemon lifecycle — cooperative "ensure it's up, never own it".
 *
 * Runs diffwiki's daemon on a private index (`diffwiki`) and a private port
 * (not qmd's default `8181`) so it never collides with a daemon the user runs
 * themselves. Only ever *starts* the daemon — never stops or restarts it.
 * `fetch` and `spawn` are injected for testability. On any failure `ensureDaemon`
 * resolves to `null` and the caller falls back to the cold CLI.
 *
 * @module
 */

import type { FetchFn, SpawnFn, EnsureDaemonOptions } from './types.js';

// Re-export so existing imports from daemon.js continue to resolve.
export type { FetchFn, DetachedChild, SpawnFn, EnsureDaemonOptions } from './types.js';

/**
 * Default host. Uses `localhost` not `127.0.0.1`: qmd 2.5.3 binds on IPv6
 * `::1` even when passed `--host 127.0.0.1`, so an IPv4 probe never connects.
 * Overridable via `DIFFWIKI_QMD_MCP_HOST`.
 */
export const DEFAULT_MCP_HOST = 'localhost';

/**
 * Default port — deliberately not qmd's own `8181` to avoid colliding with a
 * user-started daemon. Overridable via `DIFFWIKI_QMD_MCP_PORT`.
 */
export const DEFAULT_MCP_PORT = 8191;

/** Resolve the daemon host from the env, falling back to the default. */
export function mcpHost(env: NodeJS.ProcessEnv): string {
  const raw = env.DIFFWIKI_QMD_MCP_HOST;
  return raw && raw.length > 0 ? raw : DEFAULT_MCP_HOST;
}

/** Resolve the daemon port from the env, falling back to the default. */
export function mcpPort(env: NodeJS.ProcessEnv): number {
  const raw = env.DIFFWIKI_QMD_MCP_PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MCP_PORT;
}

/** Base URL (`http://<host>:<port>`) of the daemon for the given env. */
export function mcpBaseUrl(env: NodeJS.ProcessEnv): string {
  return `http://${mcpHost(env)}:${mcpPort(env)}`;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Probe `GET <baseUrl>/health`. Returns true iff the daemon answers 200 with `status: "ok"`. Never throws. */
export async function probeHealth(baseUrl: string, fetchFn: FetchFn, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${baseUrl}/health`, { method: 'GET', signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: unknown };
    return body != null && body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ensure the qmd MCP daemon is running and return its base URL.
 *
 * Returns the URL immediately if `/health` is already OK. Otherwise spawns
 * `qmd mcp --http --daemon --index diffwiki` fully detached (so it outlives
 * this one-shot plugin process), then polls `/health`. Returns `null` if the
 * daemon never comes up or spawn throws.
 *
 * @param env   qmd environment (relocated XDG dirs) the daemon inherits.
 * @param opts  Injectable `fetch` / `spawn` / timing knobs.
 */
export async function ensureDaemon(env: NodeJS.ProcessEnv, opts: EnsureDaemonOptions = {}): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const maxPolls = opts.maxPolls ?? 30;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;
  const qmdCommand = opts.qmdCommand && opts.qmdCommand.length > 0 ? opts.qmdCommand : ['qmd'];
  const baseUrl = mcpBaseUrl(env);

  if (await probeHealth(baseUrl, fetchFn, probeTimeoutMs)) {
    return baseUrl;
  }

  const spawnFn = opts.spawnFn;
  if (!spawnFn) {
    // Load the real spawn lazily so the module stays test-friendly.
    const { spawn } = await import('node:child_process');
    return startAndPoll(baseUrl, env, (command, args, options) => spawn(command, args as string[], options), fetchFn, {
      maxPolls,
      pollIntervalMs,
      probeTimeoutMs,
      sleep,
      qmdCommand,
    });
  }

  return startAndPoll(baseUrl, env, spawnFn, fetchFn, { maxPolls, pollIntervalMs, probeTimeoutMs, sleep, qmdCommand });
}

async function startAndPoll(
  baseUrl: string,
  env: NodeJS.ProcessEnv,
  spawnFn: SpawnFn,
  fetchFn: FetchFn,
  timing: {
    maxPolls: number;
    pollIntervalMs: number;
    probeTimeoutMs: number;
    sleep: (ms: number) => Promise<void>;
    qmdCommand: readonly string[];
  },
): Promise<string | null> {
  try {
    // Private index + port: never collides with a user-run qmd daemon.
    const [file, ...prefix] = timing.qmdCommand;
    const child = spawnFn(
      file,
      [
        ...prefix,
        'mcp',
        '--http',
        '--daemon',
        '--index',
        'diffwiki',
        '--host',
        mcpHost(env),
        '--port',
        String(mcpPort(env)),
      ],
      { env, detached: true, stdio: 'ignore' },
    );
    child.unref();
  } catch {
    return null;
  }

  for (let i = 0; i < timing.maxPolls; i++) {
    await timing.sleep(timing.pollIntervalMs);
    if (await probeHealth(baseUrl, fetchFn, timing.probeTimeoutMs)) {
      return baseUrl;
    }
  }
  return null;
}
