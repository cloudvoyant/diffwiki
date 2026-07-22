// WHY mocked SDK (and NEVER real qmd) in CI:
// `@tobilu/qmd` pulls in native binaries (node-llama-cpp, better-sqlite3) that are
// built/downloaded at install time, and its vector/hybrid search downloads multi-GB
// GGUF models from HuggingFace on first use. Running real qmd here would make the
// suite slow, network-dependent, and flaky. Every test mocks the SDK's process utilities
// so the adapter's op -> CLI mapping and JSON parsing are exercised in isolation.
//
// NOTE: Full test rewrite is deferred to Phase 5. This is the minimal update to make
// tests compile and pass against the new `makePluginDefinition` + SDK-based qmd.ts.
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the SDK process utilities at the module level so qmd.ts (which imports them)
// gets our fakes. Each test sets up its own return values via mockImplementation.
// Shared across the mock factory (hoisted above imports) so resolveDependency
// can delegate to the same commandExists mock the tests toggle.
const { commandExistsMock } = vi.hoisted(() => ({ commandExistsMock: vi.fn() }));

vi.mock('diffwiki-core/plugin', () => ({
  runProcess: vi.fn(),
  runProcessJson: vi.fn(),
  commandExists: commandExistsMock,
  // qmd.ts resolves its binary through resolveDependency; delegate to the same
  // commandExists mock so `mockCommandExists.mockResolvedValue(true|false)`
  // drives qmd presence, and report file === 'qmd' when present.
  resolveDependency: vi.fn(async (dependency: { command: string }) =>
    (await commandExistsMock(dependency.command))
      ? { dependency, command: ['qmd'], source: 'path' }
      : { dependency, command: null, source: 'missing' },
  ),
  definePlugin: vi.fn((def: unknown) => ({ definition: def, run: vi.fn() })),
}));

import { runProcess, runProcessJson, commandExists } from 'diffwiki-core/plugin';
import {
  makePluginDefinition,
  newestMdMtime,
  parseQmdStatus,
  searchSubcommand,
  splitQmdPath,
  type QmdRow,
  type StatMtimeFn,
} from '../src/bin.js';
import { qmdIndexPath, resetQmdResolution } from '../src/qmd.js';
import type { FetchFn, SpawnFn } from '../src/daemon.js';

const noopLog = () => {};

/** A fetch that always fails, making the warm path immediately fall back to cold. */
const coldOnlyFetch: FetchFn = async () => {
  throw new Error('no daemon');
};

/** A spawn that does nothing — prevents real process starts in cold-only tests. */
const neverSpawn: SpawnFn = () => ({ unref: () => {} });

const mockRunProcess = vi.mocked(runProcess);
const mockRunProcessJson = vi.mocked(runProcessJson);
const mockCommandExists = vi.mocked(commandExists);

beforeEach(() => {
  vi.clearAllMocks();
  // The qmd binary resolution is cached per process; clear it so each test's
  // commandExists toggle is honoured.
  resetQmdResolution();
  // Default: qmd resolves (present). The missing-qmd tests override to false.
  mockCommandExists.mockResolvedValue(true);
  // Disable warm mode so tests exercise only the cold CLI path.
  process.env.DIFFWIKI_QMD_WARM = '0';
});

afterEach(() => {
  delete process.env.DIFFWIKI_QMD_WARM;
});

const SAMPLE_ROWS: QmdRow[] = [
  {
    file: 'qmd://docs/guide/intro.md',
    displayPath: 'docs/guide/intro.md',
    title: 'Intro',
    bestChunk: 'the intro chunk',
    score: 0.91,
    docid: 'doc-1',
  },
  {
    file: 'qmd://notes/todo.md',
    displayPath: 'notes/todo.md',
    title: 'Todo',
    bestChunk: 'a todo',
    score: 0.42,
    docid: 'doc-2',
  },
];

describe('splitQmdPath', () => {
  it('strips qmd:// and splits collection from relPath', () => {
    expect(splitQmdPath({ file: 'qmd://docs/guide/intro.md' })).toEqual({
      collection: 'docs',
      relPath: 'guide/intro.md',
    });
  });

  it('falls back to displayPath when file is absent', () => {
    expect(splitQmdPath({ displayPath: 'notes/todo.md' })).toEqual({
      collection: 'notes',
      relPath: 'todo.md',
    });
  });

  it('handles a bare collection with no relPath', () => {
    expect(splitQmdPath({ file: 'qmd://docs' })).toEqual({ collection: 'docs', relPath: '' });
  });

  it('strips the ?index=<name> query qmd adds for a named index', () => {
    expect(splitQmdPath({ file: 'qmd://devtools/helix/splits.md?index=diffwiki' })).toEqual({
      collection: 'devtools',
      relPath: 'helix/splits.md',
    });
    // also on displayPath, and with a #fragment
    expect(splitQmdPath({ displayPath: 'notes/todo.md?index=diffwiki#frag' })).toEqual({
      collection: 'notes',
      relPath: 'todo.md',
    });
  });
});

describe('parseQmdStatus', () => {
  it('scrapes docs indexed and pending embeddings from human status text', () => {
    const text = '  Total:    110 files indexed\n  Vectors:  0 embedded\n  Pending:  110 need embedding\n';
    expect(parseQmdStatus(text)).toEqual({ docsIndexed: 110, embeddingsPending: 110 });
  });

  it('returns zeros when the lines are absent', () => {
    expect(parseQmdStatus('nothing here')).toEqual({ docsIndexed: 0, embeddingsPending: 0 });
  });
});

describe('qmdIndexPath', () => {
  it('points at <home>/qmd/qmd/<index>.sqlite', () => {
    expect(qmdIndexPath('/home/u/.diffwiki')).toBe('/home/u/.diffwiki/qmd/qmd/diffwiki.sqlite');
  });
});

describe('searchSubcommand', () => {
  it('maps types to qmd subcommands', () => {
    expect(searchSubcommand('keyword')).toBe('search');
    expect(searchSubcommand('semantic')).toBe('vsearch');
    expect(searchSubcommand('hybrid')).toBe('query');
    expect(searchSubcommand(undefined)).toBe('search');
  });
});

describe('search handler', () => {
  it.each([
    ['keyword', 'search'],
    ['semantic', 'vsearch'],
    ['hybrid', 'query'],
  ])('type %s uses qmd %s and maps rows to hits', async (type, sub) => {
    mockRunProcessJson.mockResolvedValue(SAMPLE_ROWS);
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.search(
      { term: 'foo', type, collections: [], collection: undefined, limit: undefined },
      noopLog,
    );

    expect(mockRunProcessJson).toHaveBeenCalledTimes(1);
    const [file, args] = mockRunProcessJson.mock.calls[0];
    expect(file).toBe('qmd');
    expect(args[0]).toBe(sub);
    expect(args).toContain('--index');
    expect(args).toContain('diffwiki');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(result.hits).toEqual([
      {
        collection: 'docs',
        relPath: 'guide/intro.md',
        title: 'Intro',
        snippet: 'the intro chunk',
        score: 0.91,
        docid: 'doc-1',
      },
      {
        collection: 'notes',
        relPath: 'todo.md',
        title: 'Todo',
        snippet: 'a todo',
        score: 0.42,
        docid: 'doc-2',
      },
    ]);
  });

  it('applies the default limit of 20', async () => {
    mockRunProcessJson.mockResolvedValue([]);
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search(
      { term: 'foo', type: 'keyword', collections: [], collection: undefined, limit: undefined },
      noopLog,
    );
    const [, args] = mockRunProcessJson.mock.calls[0];
    const nIdx = (args as string[]).indexOf('-n');
    expect(nIdx).toBeGreaterThan(-1);
    expect((args as string[])[nIdx + 1]).toBe('20');
  });

  it('adds -c <collection> when a collection filter is set', async () => {
    mockRunProcessJson.mockResolvedValue([]);
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search(
      { term: 'foo', type: 'keyword', collection: 'docs', collections: [], limit: undefined },
      noopLog,
    );
    const [, args] = mockRunProcessJson.mock.calls[0];
    const cIdx = (args as string[]).indexOf('-c');
    expect(cIdx).toBeGreaterThan(-1);
    expect((args as string[])[cIdx + 1]).toBe('docs');
  });
});

describe('health handler', () => {
  it('maps qmd status to readiness with firstSearchCost instant when index built', async () => {
    mockCommandExists.mockResolvedValue(true);
    mockRunProcess.mockResolvedValue({
      stdout: '  Total:    128 files indexed\n  Vectors:  128 embedded\n  Pending:  0 need embedding\n',
      stderr: '',
    });
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(true);
    expect(result.readiness?.toolInstalled).toBe(true);
    expect(result.readiness?.indexBuilt).toBe(true);
    expect(result.readiness?.docsIndexed).toBe(128);
    expect(result.readiness?.embeddingsPending).toBe(0);
    expect(result.readiness?.firstSearchCost).toBe('instant');
  });

  it('reports firstSearchCost model-download and a diagnostic when tool missing', async () => {
    mockCommandExists.mockResolvedValue(false);
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(false);
    expect(result.readiness?.toolInstalled).toBe(false);
    expect(result.readiness?.firstSearchCost).toBe('model-download');
    expect(result.diagnostics.some((d) => d.level === 'error')).toBe(true);
  });
});

describe('setup handler', () => {
  it('returns ready:false and a diagnostic log when qmd is missing', async () => {
    mockCommandExists.mockResolvedValue(false);
    const log = vi.fn();
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.setup(
      { collections: [{ name: 'docs', path: '/abs/docs' }], embed: undefined, prefetchModels: undefined },
      log,
    );

    expect(result.ready).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps?.[0]).toMatchObject({ step: 'verify-qmd', ok: false });
    expect(result.steps?.[0].message).toContain('qmd unresolved');
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('npm i -g @tobilu/qmd'));
  });

  it('adds collections and indexes when qmd is present, ignoring "already exists"', async () => {
    mockCommandExists.mockResolvedValue(true);
    mockRunProcess.mockImplementation(async (_file, args) => {
      if ((args as string[])[0] === 'collection' && (args as string[])[1] === 'add') {
        throw new Error('collection already exists');
      }
      return { stdout: 'ok', stderr: '' };
    });
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.setup(
      { collections: [{ name: 'docs', path: '/abs/docs' }], embed: undefined, prefetchModels: undefined },
      noopLog,
    );

    expect(result.ready).toBe(true);
    expect(result.steps?.find((s) => s.step === 'verify-qmd')?.ok).toBe(true);
    expect(result.steps?.find((s) => s.step === 'add-collections')?.ok).toBe(true);
    expect(result.steps?.find((s) => s.step === 'index')?.ok).toBe(true);
    // no embed step because embed/prefetchModels were not requested
    expect(result.steps?.find((s) => s.step === 'embed')).toBeUndefined();
  });
});

describe('index and onEvent handlers', () => {
  it('index returns the collection count and runs update', async () => {
    mockRunProcess.mockResolvedValue({ stdout: 'ok', stderr: '' });
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.index(
      {
        collections: [
          { name: 'docs', path: '/abs/docs' },
          { name: 'notes', path: '/abs/notes' },
        ],
        embed: undefined,
      },
      noopLog,
    );

    expect(result.indexed).toBe(2);
    expect(mockRunProcess.mock.calls.some((c) => (c[1] as string[]).includes('update'))).toBe(true);
  });

  it('onEvent is best-effort and returns accepted even when update fails', async () => {
    mockRunProcess.mockRejectedValue(new Error('transient failure'));
    const { handlers } = makePluginDefinition({ home: '/tmp/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    const result = await handlers.onEvent(
      { event: 'article-updated', collection: { name: 'docs', path: '/abs/docs' }, collections: [] },
      noopLog,
    );

    expect(result.accepted).toBe(true);
  });
});

describe('describe via definition', () => {
  it('advertises capabilities', () => {
    const { definition } = makePluginDefinition({ home: '/custom/home', fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    expect(definition.name).toBe('diffwiki-qmd');
    expect(definition.kind).toBe('search');
    expect(definition.capabilities.searchTypes).toEqual(['keyword', 'semantic', 'hybrid']);
    expect(definition.capabilities.collectionFilter).toBe(true);
    expect(definition.capabilities.events).toBe(true);
  });
});

describe('search handler — staleness check', () => {
  const HOME = '/tmp/test-home';

  it('runs qmd update before search when index is stale', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    mockRunProcess.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return { stdout: '', stderr: '' };
    });
    mockRunProcessJson.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return [];
    });
    // Content is newer (2000) than all index files (1000) — stale
    const base = qmdIndexPath(HOME);
    const indexPaths = new Set([base, `${base}-wal`, `${base}-shm`]);
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (indexPaths.has(filePath)) return 1000;
      return 2000; // all content files are newer
    };

    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-stale-test-'));
    const docsDir = join(tmpBase, 'docs');
    const notesDir = join(tmpBase, 'notes');
    await import('node:fs/promises').then((fs) => fs.mkdir(docsDir, { recursive: true }));
    await import('node:fs/promises').then((fs) => fs.mkdir(notesDir, { recursive: true }));
    await writeFile(join(docsDir, 'article.md'), '# test', 'utf8');

    const collections = [
      { name: 'docs', path: docsDir },
      { name: 'notes', path: notesDir },
    ];

    const { handlers } = makePluginDefinition({ home: HOME, statMtime, fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search({ term: 'foo', type: 'keyword', collections }, noopLog);

    // qmd update should have been called BEFORE the search subcommand
    const updateIdx = calls.findIndex((c) => (c.args as string[]).includes('update'));
    const searchIdx = calls.findIndex(
      (c) => c.args[0] === 'search' || c.args[0] === 'vsearch' || c.args[0] === 'query',
    );
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeGreaterThan(updateIdx);

    await rm(tmpBase, { recursive: true, force: true });
  });

  it('skips qmd update when index is fresh', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    mockRunProcess.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return { stdout: '', stderr: '' };
    });
    mockRunProcessJson.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return [];
    });
    // Index is newer (3000) than content (2000) — fresh
    const base = qmdIndexPath(HOME);
    const indexPaths = new Set([base, `${base}-wal`, `${base}-shm`]);
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (indexPaths.has(filePath)) return 3000;
      return 2000;
    };

    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-fresh-test-'));
    const docsDir = join(tmpBase, 'docs');
    await import('node:fs/promises').then((fs) => fs.mkdir(docsDir, { recursive: true }));
    await writeFile(join(docsDir, 'article.md'), '# test', 'utf8');

    const collections = [{ name: 'docs', path: docsDir }];

    const { handlers } = makePluginDefinition({ home: HOME, statMtime, fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search({ term: 'foo', type: 'keyword', collections }, noopLog);

    // Only the search subcommand should have been called — no update
    expect(calls.every((c) => !(c.args as string[]).includes('update'))).toBe(true);
    expect(calls.some((c) => c.args[0] === 'search')).toBe(true);

    await rm(tmpBase, { recursive: true, force: true });
  });

  it('treats a fresh -wal file as fresh even when the base .sqlite is stale', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    mockRunProcess.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return { stdout: '', stderr: '' };
    });
    mockRunProcessJson.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return [];
    });
    // qmd runs in WAL mode: the base .sqlite mtime is frozen old (1000) but the
    // committed writes land in -wal, whose mtime (3000) beats content (2000).
    const base = qmdIndexPath(HOME);
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (filePath === base) return 1000;
      if (filePath === `${base}-wal`) return 3000;
      if (filePath === `${base}-shm`) return 3000;
      return 2000; // content files
    };

    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-wal-fresh-test-'));
    const docsDir = join(tmpBase, 'docs');
    await import('node:fs/promises').then((fs) => fs.mkdir(docsDir, { recursive: true }));
    await writeFile(join(docsDir, 'article.md'), '# test', 'utf8');

    const collections = [{ name: 'docs', path: docsDir }];

    const { handlers } = makePluginDefinition({ home: HOME, statMtime, fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search({ term: 'foo', type: 'keyword', collections }, noopLog);

    // The -wal mtime keeps the index fresh, so no update runs.
    expect(calls.every((c) => !(c.args as string[]).includes('update'))).toBe(true);
    expect(calls.some((c) => c.args[0] === 'search')).toBe(true);

    await rm(tmpBase, { recursive: true, force: true });
  });

  it('runs qmd update when all three index files are older than content', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    mockRunProcess.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return { stdout: '', stderr: '' };
    });
    mockRunProcessJson.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return [];
    });
    // base=1000, -wal=1500, -shm=0 (absent); all below content (2000) — stale.
    const base = qmdIndexPath(HOME);
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (filePath === base) return 1000;
      if (filePath === `${base}-wal`) return 1500;
      if (filePath === `${base}-shm`) return 0;
      return 2000; // content files
    };

    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-wal-stale-test-'));
    const docsDir = join(tmpBase, 'docs');
    await import('node:fs/promises').then((fs) => fs.mkdir(docsDir, { recursive: true }));
    await writeFile(join(docsDir, 'article.md'), '# test', 'utf8');

    const collections = [{ name: 'docs', path: docsDir }];

    const { handlers } = makePluginDefinition({ home: HOME, statMtime, fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search({ term: 'foo', type: 'keyword', collections }, noopLog);

    const updateIdx = calls.findIndex((c) => (c.args as string[]).includes('update'));
    expect(updateIdx).toBeGreaterThanOrEqual(0);

    await rm(tmpBase, { recursive: true, force: true });
  });

  it('runs qmd embed after update for semantic search when embeddings pending', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    mockRunProcess.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      if ((args as string[])[0] === 'status') {
        return {
          stdout: '  Total:    5 files indexed\n  Pending:  3 need embedding\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    mockRunProcessJson.mockImplementation(async (file, args) => {
      calls.push({ file: file as string, args: args as readonly string[] });
      return [];
    });
    const base = qmdIndexPath(HOME);
    const indexPaths = new Set([base, `${base}-wal`, `${base}-shm`]);
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (indexPaths.has(filePath)) return 1000;
      return 2000;
    };

    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-embed-test-'));
    const docsDir = join(tmpBase, 'docs');
    await import('node:fs/promises').then((fs) => fs.mkdir(docsDir, { recursive: true }));
    await writeFile(join(docsDir, 'article.md'), '# test', 'utf8');

    const collections = [{ name: 'docs', path: docsDir }];

    const { handlers } = makePluginDefinition({ home: HOME, statMtime, fetchFn: coldOnlyFetch, spawnFn: neverSpawn });
    await handlers.search({ term: 'foo', type: 'semantic', collections }, noopLog);

    const updateIdx = calls.findIndex((c) => (c.args as string[]).includes('update'));
    const embedIdx = calls.findIndex((c) => (c.args as string[]).includes('embed'));
    const searchIdx = calls.findIndex((c) => c.args[0] === 'vsearch');
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(embedIdx).toBeGreaterThan(updateIdx);
    expect(searchIdx).toBeGreaterThan(embedIdx);

    await rm(tmpBase, { recursive: true, force: true });
  });
});

describe('newestMdMtime helper', () => {
  it('returns 0 for an empty directory', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-mtime-test-'));
    const result = await newestMdMtime([tmpBase], async () => 500);
    expect(result).toBe(0);
    await rm(tmpBase, { recursive: true, force: true });
  });

  it('returns the max mtime across markdown files', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpBase = await mkdtemp(join(tmpdir(), 'qmd-mtime-test-'));
    await writeFile(join(tmpBase, 'a.md'), '# a', 'utf8');
    await writeFile(join(tmpBase, 'b.mdx'), '# b', 'utf8');
    await writeFile(join(tmpBase, 'c.txt'), 'ignored', 'utf8');

    const mtimes: Record<string, number> = {};
    mtimes[join(tmpBase, 'a.md')] = 100;
    mtimes[join(tmpBase, 'b.mdx')] = 300;

    const statFn: StatMtimeFn = async (p) => mtimes[p] ?? 0;
    const result = await newestMdMtime([tmpBase], statFn);
    expect(result).toBe(300);

    await rm(tmpBase, { recursive: true, force: true });
  });
});
