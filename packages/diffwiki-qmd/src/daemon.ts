/**
 * qmd warm-daemon lifecycle — cooperative "ensure it's up, never own it".
 *
 * The diffwiki-qmd plugin binary is one-shot, but the expensive GGUF embedding
 * models can stay resident in an external, long-lived
 * `qmd mcp --http --daemon --index diffwiki` process. This module *ensures* that
 * daemon is running (spinning it up fully detached if it is down) and returns
 * its base URL so the MCP client (`./mcp`) can run searches against warm models.
 *
 * **Isolation — diffwiki never interferes with your own qmd usage.** qmd may be
 * used directly, outside diffwiki (its own daemon, its own indexes). So diffwiki
 * runs its *own* daemon serving a *private* named index (`diffwiki`) on a
 * *private* port (`DEFAULT_MCP_PORT`, deliberately NOT qmd's own `8181` default),
 * and only ever *starts* it — it never stops, kills, or restarts the process.
 * That keeps diffwiki a cooperative client: it owns its index, not the daemon's
 * lifecycle, and it can never pick up (or collide with) a daemon you started for
 * a different index.
 *
 * `fetch` and `spawn` are injected (`FetchFn` / `SpawnFn`) so unit tests can
 * drive the health probe and the detached start without touching the network
 * or spawning a real process. Everything here is best-effort: on any failure
 * `ensureDaemon` resolves to `null` and the caller falls back to the cold CLI.
 *
 * Protocol facts (host/port, detached-start requirement, `/health` shape) come
 * from the verified research in
 * `.codevoyant/plans/plugin-sdk-refactor/research/qmd-daemon-http.md`.
 *
 * @module
 */

/**
 * Default host for reaching diffwiki's qmd daemon. Uses `localhost` (NOT
 * `127.0.0.1`): qmd 2.5.3 binds the MCP server on IPv6 `localhost` (`::1`) even
 * when passed `--host 127.0.0.1`, so an IPv4 probe never connects. `localhost`
 * lets Node's resolver reach whichever stack the daemon actually bound.
 * Overridable via `DIFFWIKI_QMD_MCP_HOST`.
 */
export const DEFAULT_MCP_HOST = 'localhost';

/**
 * Default port for diffwiki's *private* qmd daemon. Deliberately NOT qmd's own
 * `8181` default, so diffwiki never collides with — or accidentally reuses — a
 * daemon you started yourself for a different index. Overridable via
 * `DIFFWIKI_QMD_MCP_PORT`.
 */
export const DEFAULT_MCP_PORT = 8191;

/**
 * A minimal `fetch`-shaped function: enough of the WHATWG fetch surface for the
 * health probe and the MCP client. Injected for testability.
 */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

/** A minimal detached child returned by `SpawnFn` — only `.unref()` is used. */
export interface DetachedChild {
  unref(): void;
}

/**
 * A `spawn`-shaped function used only to launch the detached daemon. Injected
 * for testability so tests never start a real process.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; detached?: boolean; stdio?: 'ignore' },
) => DetachedChild;

/** Options for {@link ensureDaemon}. All fields are optional and injectable. */
export interface EnsureDaemonOptions {
  /** Injected fetch. Defaults to global `fetch`. */
  fetchFn?: FetchFn;
  /** Injected spawn. Defaults to `child_process.spawn`. */
  spawnFn?: SpawnFn;
  /** Max number of `/health` poll attempts after a start. Default 30. */
  maxPolls?: number;
  /** Delay between poll attempts, in ms. Default 500. */
  pollIntervalMs?: number;
  /** Per-probe timeout, in ms. Default 1000. */
  probeTimeoutMs?: number;
  /** Sleep function (injected in tests to avoid real timers). Default a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

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

/**
 * Probe `GET <baseUrl>/health`. Returns true iff the daemon answers `200` with
 * a body reporting `status: "ok"`. Never throws — any error resolves to false.
 */
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
 * If `GET /health` already reports OK, returns the base URL without spawning.
 * Otherwise spawns `qmd mcp --http --daemon --index diffwiki` **fully
 * detached** (`{ detached: true, stdio: 'ignore' }` + `.unref()`, so it
 * survives the one-shot plugin exiting — a non-detached start dies with the
 * parent, per the research doc), then polls `/health` (bounded). Returns the
 * base URL once healthy, or `null` if the daemon never comes up or the spawn
 * throws.
 *
 * @param env   The qmd environment (relocated XDG dirs) the daemon inherits.
 * @param opts  Injectable `fetch` / `spawn` / timing knobs.
 */
export async function ensureDaemon(env: NodeJS.ProcessEnv, opts: EnsureDaemonOptions = {}): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const maxPolls = opts.maxPolls ?? 30;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;
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
    });
  }

  return startAndPoll(baseUrl, env, spawnFn, fetchFn, { maxPolls, pollIntervalMs, probeTimeoutMs, sleep });
}

async function startAndPoll(
  baseUrl: string,
  env: NodeJS.ProcessEnv,
  spawnFn: SpawnFn,
  fetchFn: FetchFn,
  timing: { maxPolls: number; pollIntervalMs: number; probeTimeoutMs: number; sleep: (ms: number) => Promise<void> },
): Promise<string | null> {
  try {
    // Bind diffwiki's OWN private index + port so this daemon never collides
    // with a qmd daemon the user runs themselves (different index/port).
    const child = spawnFn(
      'qmd',
      ['mcp', '--http', '--daemon', '--index', 'diffwiki', '--host', mcpHost(env), '--port', String(mcpPort(env))],
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
