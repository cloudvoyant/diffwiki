/**
 * diffwiki-qmd daemon-lifecycle unit tests.
 *
 * A fake `fetch` drives the `/health` probe and a fake `spawn` records the
 * detached-start call — never a real daemon or process.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ensureDaemon,
  mcpBaseUrl,
  mcpHost,
  mcpPort,
  probeHealth,
  type DetachedChild,
  type FetchFn,
  type SpawnFn,
} from '../src/daemon.js';

const noSleep = async (): Promise<void> => {};

/** A fake fetch that answers `/health` with a scripted sequence of ok/not-ok. */
function fakeFetch(healthResults: boolean[]): { fetchFn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetchFn: FetchFn = async (url) => {
    calls.push(url);
    const ok = healthResults[Math.min(i, healthResults.length - 1)] ?? false;
    i += 1;
    return {
      ok,
      status: ok ? 200 : 503,
      headers: { get: () => null },
      text: async () => (ok ? '{"status":"ok","uptime":1}' : ''),
      json: async () => (ok ? { status: 'ok', uptime: 1 } : { status: 'down' }),
    };
  };
  return { fetchFn, calls };
}

/** A fake spawn that records its invocation and returns an unref-able child. */
function fakeSpawn(): { spawnFn: SpawnFn; calls: Array<{ command: string; args: readonly string[] }>; unrefs: number } {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  let unrefs = 0;
  const spawnFn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    const child: DetachedChild = {
      unref: () => {
        unrefs += 1;
      },
    };
    return child;
  };
  return {
    spawnFn,
    calls,
    get unrefs() {
      return unrefs;
    },
  } as { spawnFn: SpawnFn; calls: Array<{ command: string; args: readonly string[] }>; unrefs: number };
}

describe('env resolution', () => {
  it('defaults host/port and builds the base url', () => {
    expect(mcpHost({})).toBe('127.0.0.1');
    expect(mcpPort({})).toBe(8191);
    expect(mcpBaseUrl({})).toBe('http://127.0.0.1:8191');
  });

  it('honours DIFFWIKI_QMD_MCP_HOST / _PORT overrides', () => {
    const env = { DIFFWIKI_QMD_MCP_HOST: '0.0.0.0', DIFFWIKI_QMD_MCP_PORT: '9999' } as NodeJS.ProcessEnv;
    expect(mcpBaseUrl(env)).toBe('http://0.0.0.0:9999');
  });

  it('falls back to the default port when the override is not a positive number', () => {
    expect(mcpPort({ DIFFWIKI_QMD_MCP_PORT: 'nope' } as NodeJS.ProcessEnv)).toBe(8191);
  });
});

describe('probeHealth', () => {
  it('returns true only when the daemon answers status:ok', async () => {
    const up = fakeFetch([true]);
    expect(await probeHealth('http://127.0.0.1:8191', up.fetchFn, 1000)).toBe(true);
    const down = fakeFetch([false]);
    expect(await probeHealth('http://127.0.0.1:8191', down.fetchFn, 1000)).toBe(false);
    expect(up.calls[0]).toBe('http://127.0.0.1:8191/health');
  });
});

describe('ensureDaemon', () => {
  it('health-up: returns the base url WITHOUT spawning', async () => {
    const { fetchFn, calls } = fakeFetch([true]);
    const spawn = fakeSpawn();
    const baseUrl = await ensureDaemon({}, { fetchFn, spawnFn: spawn.spawnFn, sleep: noSleep });
    expect(baseUrl).toBe('http://127.0.0.1:8191');
    expect(spawn.calls).toHaveLength(0);
    expect(calls).toEqual(['http://127.0.0.1:8191/health']);
  });

  it('health-down: spawns detached, unrefs, then polls until healthy', async () => {
    // 1st probe down (triggers start), 2nd probe still down, 3rd probe up.
    const { fetchFn } = fakeFetch([false, false, true]);
    const spawn = fakeSpawn();
    const baseUrl = await ensureDaemon({}, { fetchFn, spawnFn: spawn.spawnFn, sleep: noSleep, maxPolls: 5 });
    expect(baseUrl).toBe('http://127.0.0.1:8191');
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].command).toBe('qmd');
    expect(spawn.calls[0].args).toEqual([
      'mcp',
      '--http',
      '--daemon',
      '--index',
      'diffwiki',
      '--host',
      '127.0.0.1',
      '--port',
      '8191',
    ]);
    expect(spawn.unrefs).toBe(1);
  });

  it('health-down and never comes up: returns null after bounded polls', async () => {
    const { fetchFn } = fakeFetch([false]);
    const spawn = fakeSpawn();
    const baseUrl = await ensureDaemon({}, { fetchFn, spawnFn: spawn.spawnFn, sleep: noSleep, maxPolls: 3 });
    expect(baseUrl).toBeNull();
    expect(spawn.calls).toHaveLength(1);
  });

  it('returns null when spawn throws', async () => {
    const { fetchFn } = fakeFetch([false]);
    const spawnFn: SpawnFn = () => {
      throw new Error('spawn EACCES');
    };
    const baseUrl = await ensureDaemon({}, { fetchFn, spawnFn, sleep: noSleep, maxPolls: 3 });
    expect(baseUrl).toBeNull();
  });

  it('passes the qmd env through to spawn', async () => {
    const { fetchFn } = fakeFetch([false, true]);
    const recorded: Array<{ env?: NodeJS.ProcessEnv; detached?: boolean; stdio?: string }> = [];
    const spawnFn: SpawnFn = (_command, _args, options) => {
      recorded.push(options);
      return { unref: vi.fn() };
    };
    await ensureDaemon({ XDG_CACHE_HOME: '/tmp/qmd' } as NodeJS.ProcessEnv, {
      fetchFn,
      spawnFn,
      sleep: noSleep,
      maxPolls: 3,
    });
    expect(recorded[0].detached).toBe(true);
    expect(recorded[0].stdio).toBe('ignore');
    expect(recorded[0].env?.XDG_CACHE_HOME).toBe('/tmp/qmd');
  });
});
