/**
 * diffwiki-qmd warm/cold routing tests for the search handler.
 *
 * The qmd CLI module is mocked so the cold path never spawns qmd, and a fake
 * `fetch` / `spawn` drive the warm path. Asserts: warm success returns warm
 * hits (no cold CLI call), HTTP failure falls back to the cold CLI, and
 * `DIFFWIKI_QMD_WARM=0` forces cold without touching the daemon.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { FetchFn, SpawnFn } from '../src/daemon.js';

const noopLog = () => {};

/** Create a real temp collection dir with one md file so `newestMdMtime` > 0. */
async function makeCollectionDir(): Promise<{ name: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'diffwiki-qmd-coll-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'a.md'), '# a\n', 'utf8');
  return { name: 'kb', path: dir };
}

// Mock the qmd CLI module so the cold path is observable and never real.
vi.mock('../src/qmd.js', () => {
  let mockRunQmdResult = '';
  let mockRunQmdJsonResult: unknown = [];
  const calls: string[][] = [];
  return {
    INDEX: 'diffwiki',
    qmdEnv: (home: string) => {
      const base = home + '/qmd';
      return { ...process.env, XDG_CACHE_HOME: base, XDG_CONFIG_HOME: base };
    },
    modelsDir: (home: string) => home + '/qmd/qmd/models',
    qmdIndexPath: (home: string) => home + '/qmd/qmd/diffwiki.sqlite',
    qmdOnPath: async () => true,
    resolveQmd: async () => ['qmd'],
    QMD_DEPENDENCY: { command: 'qmd', npm: '@tobilu/qmd', hint: 'install qmd' },
    runQmd: async (args: readonly string[]) => {
      calls.push(['qmd', ...args]);
      return mockRunQmdResult;
    },
    runQmdJson: async <T>(args: readonly string[]) => {
      calls.push(['qmd', ...args]);
      return mockRunQmdJsonResult as T;
    },
    __setRunQmdJsonResult: (v: unknown) => {
      mockRunQmdJsonResult = v;
    },
    __setRunQmdResult: (v: string) => {
      mockRunQmdResult = v;
    },
    __getCalls: () => calls,
    __resetCalls: () => {
      calls.length = 0;
    },
  };
});

const qmdMock = (await import('../src/qmd.js')) as typeof import('../src/qmd.js') & {
  __setRunQmdJsonResult: (v: unknown) => void;
  __setRunQmdResult: (v: string) => void;
  __getCalls: () => string[][];
  __resetCalls: () => void;
};

const { makePluginDefinition } = await import('../src/bin.js');

/** Fake fetch that reports `/health` up and answers the MCP round-trip. */
function warmFetch(results: unknown[]): FetchFn {
  let mcpCall = 0;
  return async (url) => {
    if (url.endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{"status":"ok"}',
        json: async () => ({ status: 'ok' }),
      };
    }
    // /mcp
    mcpCall += 1;
    if (mcpCall === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n.toLowerCase() === 'mcp-session-id' ? 'sess-1' : null) },
        text: async () => '{}',
        json: async () => ({}),
      };
    }
    const payload = { jsonrpc: '2.0', id: 2, result: { structuredContent: { results } } };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  };
}

/** Fake fetch that reports `/health` up but fails the MCP call. */
const failingMcpFetch: FetchFn = async (url) => {
  if (url.endsWith('/health')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{"status":"ok"}',
      json: async () => ({ status: 'ok' }),
    };
  }
  return {
    ok: false,
    status: 500,
    headers: { get: () => null },
    text: async () => 'boom',
    json: async () => ({}),
  };
};

const neverSpawn: SpawnFn = () => ({ unref: () => {} });

const WARM_ROWS = [{ file: 'kb/a.md', title: 'Warm A', score: 0.9, snippet: 'warm snippet', docid: 'w1' }];
const COLD_ROWS = [
  {
    file: 'qmd://kb/b.md',
    displayPath: 'kb/b.md',
    title: 'Cold B',
    score: 0.5,
    bestChunk: 'cold snippet',
    docid: 'c1',
  },
];

const collDirs: string[] = [];

beforeEach(() => {
  qmdMock.__resetCalls();
  qmdMock.__setRunQmdJsonResult(COLD_ROWS);
  qmdMock.__setRunQmdResult('  Total: 1 files indexed\n  Pending: 0 need embedding\n');
  delete process.env.DIFFWIKI_QMD_WARM;
});

afterEach(async () => {
  while (collDirs.length > 0) {
    const dir = collDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('search handler warm/cold routing', () => {
  it('warm success returns warm hits and does NOT call the cold search CLI', async () => {
    const { handlers } = makePluginDefinition({
      home: '/tmp/home',
      statMtime: async () => 0, // no content -> ensureFresh no-ops
      fetchFn: warmFetch(WARM_ROWS),
      spawnFn: neverSpawn,
    });
    const result = await handlers.search({ term: 'foo', type: 'keyword', collections: [], limit: 20 }, noopLog);
    expect(result.hits).toEqual([
      { collection: 'kb', relPath: 'a.md', title: 'Warm A', snippet: 'warm snippet', score: 0.9, docid: 'w1' },
    ]);
    // no cold search/vsearch/query invocation
    const searchCalls = qmdMock.__getCalls().filter((c) => ['search', 'vsearch', 'query'].includes(c[1]));
    expect(searchCalls).toHaveLength(0);
  });

  it('warm HTTP failure falls back to the cold CLI search', async () => {
    const { handlers } = makePluginDefinition({
      home: '/tmp/home',
      statMtime: async () => 0,
      fetchFn: failingMcpFetch,
      spawnFn: neverSpawn,
    });
    const result = await handlers.search({ term: 'foo', type: 'keyword', collections: [], limit: 20 }, noopLog);
    expect(result.hits).toEqual([
      { collection: 'kb', relPath: 'b.md', title: 'Cold B', snippet: 'cold snippet', score: 0.5, docid: 'c1' },
    ]);
    const searchCalls = qmdMock.__getCalls().filter((c) => c[1] === 'search');
    expect(searchCalls).toHaveLength(1);
  });

  it('DIFFWIKI_QMD_WARM=0 forces cold and never probes the daemon', async () => {
    process.env.DIFFWIKI_QMD_WARM = '0';
    let fetchCalled = false;
    const spyFetch: FetchFn = async () => {
      fetchCalled = true;
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    };
    const { handlers } = makePluginDefinition({
      home: '/tmp/home',
      statMtime: async () => 0,
      fetchFn: spyFetch,
      spawnFn: neverSpawn,
    });
    const result = await handlers.search({ term: 'foo', type: 'keyword', collections: [], limit: 20 }, noopLog);
    expect(fetchCalled).toBe(false);
    expect(result.hits[0].title).toBe('Cold B');
    const searchCalls = qmdMock.__getCalls().filter((c) => c[1] === 'search');
    expect(searchCalls).toHaveLength(1);
  });

  it('skips qmd update when the daemon is holding the index (stale content)', async () => {
    const coll = await makeCollectionDir();
    collDirs.push(coll.path);
    // statMtime: md content newer (2) than every index file (1) -> stale, so
    // ensureFresh would normally run `qmd update`. But the daemon is up, so it
    // must NOT. Match the base .sqlite plus its WAL/SHM sidecars.
    const statMtime = async (p: string) => (/\.sqlite(-wal|-shm)?$/.test(p) ? 1 : 2);
    const { handlers } = makePluginDefinition({
      home: '/tmp/home',
      statMtime,
      fetchFn: warmFetch(WARM_ROWS), // /health answers ok -> daemon "up"
      spawnFn: neverSpawn,
    });
    await handlers.search({ term: 'foo', type: 'keyword', collections: [coll], limit: 20 }, noopLog);
    const updateCalls = qmdMock.__getCalls().filter((c) => c[1] === 'update');
    expect(updateCalls).toHaveLength(0);
  });

  it('runs qmd update when stale and no daemon is holding the index', async () => {
    const coll = await makeCollectionDir();
    collDirs.push(coll.path);
    const statMtime = async (p: string) => (/\.sqlite(-wal|-shm)?$/.test(p) ? 1 : 2);
    // /health is down -> daemon not up; force cold (warm off) so no daemon spawn.
    process.env.DIFFWIKI_QMD_WARM = '0';
    const downFetch: FetchFn = async () => ({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => '',
      json: async () => ({}),
    });
    const { handlers } = makePluginDefinition({
      home: '/tmp/home',
      statMtime,
      fetchFn: downFetch,
      spawnFn: neverSpawn,
    });
    await handlers.search({ term: 'foo', type: 'keyword', collections: [coll], limit: 20 }, noopLog);
    const updateCalls = qmdMock.__getCalls().filter((c) => c[1] === 'update');
    expect(updateCalls).toHaveLength(1);
  });

  it('health reports the warm daemon as running when /health is up', async () => {
    const { handlers } = makePluginDefinition({
      home: '/tmp/home',
      fetchFn: warmFetch([]),
      spawnFn: neverSpawn,
    });
    const result = await handlers.health({ collections: [] }, noopLog);
    expect(result.diagnostics.some((d) => /warm daemon running/.test(d.message))).toBe(true);
  });
});
