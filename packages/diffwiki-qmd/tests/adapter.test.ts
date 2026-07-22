// WHY a fake execFile (and NEVER real qmd) in CI:
// `@tobilu/qmd` pulls in native binaries (node-llama-cpp, better-sqlite3) that are
// built/downloaded at install time, and its vector/hybrid search downloads multi-GB
// GGUF models from HuggingFace on first use. Running real qmd here would make the
// suite slow, network-dependent, and flaky. Every test injects a canned `ExecFileFn`
// so the adapter's op -> CLI mapping and JSON parsing are exercised in isolation.
import { describe, expect, it, vi } from 'vitest';
import {
  makeHandlers,
  newestMdMtime,
  parseQmdStatus,
  qmdIndexPath,
  searchSubcommand,
  splitQmdPath,
  type QmdRow,
  type StatMtimeFn,
} from '../src/bin.js';
import type { ExecFileFn } from '../src/qmd.js';

const noopLog = () => {};

/** A fake execFile that records calls and returns per-command canned output. */
function fakeExec(handler: (file: string, args: readonly string[]) => { stdout?: string; stderr?: string } | Error): {
  exec: ExecFileFn;
  calls: string[][];
} {
  const calls: string[][] = [];
  const exec: ExecFileFn = async (file, args) => {
    calls.push([file, ...args]);
    const out = handler(file, args);
    if (out instanceof Error) throw out;
    return { stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
  };
  return { exec, calls };
}

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
    const { exec, calls } = fakeExec((_file, args) => {
      expect(args[0]).toBe(sub);
      expect(args).toContain('--index');
      expect(args).toContain('diffwiki');
      expect(args).toContain('--format');
      expect(args).toContain('json');
      return { stdout: JSON.stringify(SAMPLE_ROWS) };
    });
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.search({ term: 'foo', type }, noopLog)) as {
      hits: Array<Record<string, unknown>>;
    };

    expect(calls).toHaveLength(1);
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
    const { exec, calls } = fakeExec(() => ({ stdout: '[]' }));
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    await handlers.search({ term: 'foo', type: 'keyword' }, noopLog);
    const args = calls[0];
    const nIdx = args.indexOf('-n');
    expect(nIdx).toBeGreaterThan(-1);
    expect(args[nIdx + 1]).toBe('20');
  });

  it('adds -c <collection> when a collection filter is set', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: '[]' }));
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    await handlers.search({ term: 'foo', type: 'keyword', collection: 'docs' }, noopLog);
    const args = calls[0];
    const cIdx = args.indexOf('-c');
    expect(cIdx).toBeGreaterThan(-1);
    expect(args[cIdx + 1]).toBe('docs');
  });
});

describe('health handler', () => {
  it('maps qmd status to readiness with firstSearchCost instant when index built', async () => {
    const { exec } = fakeExec((_file, args) => {
      if (args[0] === '--version') return { stdout: 'qmd 2.5.3' };
      if (args[0] === 'status') {
        // qmd status prints human text (it does not honour --format json).
        return { stdout: '  Total:    128 files indexed\n  Vectors:  128 embedded\n  Pending:  0 need embedding\n' };
      }
      return { stdout: '' };
    });
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.health({ collections: [] }, noopLog)) as {
      ready: boolean;
      readiness: Record<string, unknown>;
    };

    expect(result.ready).toBe(true);
    expect(result.readiness.toolInstalled).toBe(true);
    expect(result.readiness.indexBuilt).toBe(true);
    expect(result.readiness.docsIndexed).toBe(128);
    expect(result.readiness.embeddingsPending).toBe(0);
    expect(result.readiness.firstSearchCost).toBe('instant');
  });

  it('reports firstSearchCost model-download and a diagnostic when tool missing', async () => {
    const { exec } = fakeExec((_file, args) => {
      if (args[0] === '--version') return new Error('command not found: qmd');
      return { stdout: '' };
    });
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.health({ collections: [] }, noopLog)) as {
      ready: boolean;
      readiness: Record<string, unknown>;
      diagnostics: Array<{ level: string; message: string }>;
    };

    expect(result.ready).toBe(false);
    expect(result.readiness.toolInstalled).toBe(false);
    expect(result.readiness.firstSearchCost).toBe('model-download');
    expect(result.diagnostics.some((d) => d.level === 'error')).toBe(true);
  });
});

describe('setup handler', () => {
  it('returns ready:false and a diagnostic log when qmd is missing', async () => {
    const { exec } = fakeExec((_file, args) => {
      if (args[0] === '--version') return new Error('command not found: qmd');
      return { stdout: '' };
    });
    const log = vi.fn();
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.setup({ collections: [{ name: 'docs', path: '/abs/docs' }] }, log)) as {
      ready: boolean;
      steps: Array<{ step: string; ok: boolean; message?: string }>;
    };

    expect(result.ready).toBe(false);
    expect(result.steps).toEqual([{ step: 'verify-qmd', ok: false, message: 'qmd not on PATH' }]);
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('npm i -g @tobilu/qmd'));
  });

  it('adds collections and indexes when qmd is present, ignoring "already exists"', async () => {
    const { exec, calls } = fakeExec((_file, args) => {
      if (args[0] === '--version') return { stdout: 'qmd 2.5.3' };
      if (args[0] === 'collection' && args[1] === 'add') {
        return new Error('collection already exists');
      }
      if (args[0] === 'update') return { stdout: 'ok' };
      return { stdout: '' };
    });
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.setup({ collections: [{ name: 'docs', path: '/abs/docs' }] }, noopLog)) as {
      ready: boolean;
      steps: Array<{ step: string; ok: boolean }>;
    };

    expect(result.ready).toBe(true);
    expect(result.steps.find((s) => s.step === 'verify-qmd')?.ok).toBe(true);
    expect(result.steps.find((s) => s.step === 'add-collections')?.ok).toBe(true);
    expect(result.steps.find((s) => s.step === 'index')?.ok).toBe(true);
    // no embed step because embed/prefetchModels were not requested
    expect(result.steps.find((s) => s.step === 'embed')).toBeUndefined();
    expect(calls.some((c) => c.includes('collection') && c.includes('add'))).toBe(true);
  });
});

describe('index and notify handlers', () => {
  it('index returns the collection count and runs update', async () => {
    const { exec, calls } = fakeExec(() => ({ stdout: 'ok' }));
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.index(
      {
        collections: [
          { name: 'docs', path: '/abs/docs' },
          { name: 'notes', path: '/abs/notes' },
        ],
      },
      noopLog,
    )) as { indexed: number };

    expect(result.indexed).toBe(2);
    expect(calls.some((c) => c.includes('update'))).toBe(true);
  });

  it('notify is best-effort and returns accepted even when update fails', async () => {
    const { exec } = fakeExec((_file, args) => {
      if (args[0] === 'update') return new Error('transient failure');
      return { stdout: '' };
    });
    const handlers = makeHandlers({ exec, home: '/tmp/home' });
    const result = (await handlers.notify(
      { event: 'article-updated', collection: { name: 'docs', path: '/abs/docs' } },
      noopLog,
    )) as { accepted: boolean };

    expect(result.accepted).toBe(true);
  });
});

describe('initialize handler', () => {
  it('advertises capabilities and captures home', () => {
    const { exec } = fakeExec(() => ({ stdout: '' }));
    const handlers = makeHandlers({ exec });
    const result = handlers.initialize({ protocol: 1, home: '/custom/home' }, noopLog) as {
      name: string;
      kind: string;
      capabilities: Record<string, unknown>;
    };

    expect(result.name).toBe('diffwiki-qmd');
    expect(result.kind).toBe('search');
    expect(result.capabilities.searchTypes).toEqual(['keyword', 'semantic', 'hybrid']);
    expect(result.capabilities.collectionFilter).toBe(true);
    expect(result.capabilities.hooks).toBe(true);
    expect(result.capabilities.setup).toBe(true);
  });
});

describe('search handler — staleness check', () => {
  const HOME = '/tmp/test-home';

  it('runs qmd update before search when index is stale', async () => {
    const calls: string[][] = [];
    const exec: ExecFileFn = async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === 'search' || args[0] === 'vsearch' || args[0] === 'query') {
        return { stdout: '[]', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    // Content is newer (2000) than the index (1000) — stale
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (filePath === qmdIndexPath(HOME)) return 1000;
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

    const handlers = makeHandlers({ exec, home: HOME, statMtime });
    await handlers.search({ term: 'foo', type: 'keyword', collections }, noopLog);

    // qmd update should have been called BEFORE the search subcommand
    const updateIdx = calls.findIndex((c) => c.includes('update'));
    const searchIdx = calls.findIndex((c) => c[1] === 'search' || c[1] === 'vsearch' || c[1] === 'query');
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeGreaterThan(updateIdx);

    await rm(tmpBase, { recursive: true, force: true });
  });

  it('skips qmd update when index is fresh', async () => {
    const calls: string[][] = [];
    const exec: ExecFileFn = async (file, args) => {
      calls.push([file, ...args]);
      return { stdout: '[]', stderr: '' };
    };
    // Index is newer (3000) than content (2000) — fresh
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (filePath === qmdIndexPath(HOME)) return 3000;
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

    const handlers = makeHandlers({ exec, home: HOME, statMtime });
    await handlers.search({ term: 'foo', type: 'keyword', collections }, noopLog);

    // Only the search subcommand should have been called — no update
    expect(calls.every((c) => !c.includes('update'))).toBe(true);
    expect(calls.some((c) => c[1] === 'search')).toBe(true);

    await rm(tmpBase, { recursive: true, force: true });
  });

  it('runs qmd embed after update for semantic search when embeddings pending', async () => {
    const calls: string[][] = [];
    const exec: ExecFileFn = async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === 'vsearch') return { stdout: '[]', stderr: '' };
      if (args[0] === 'status') {
        // Human-format status: 3 of 5 pending embedding.
        return { stdout: '  Total:    5 files indexed\n  Pending:  3 need embedding\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const statMtime: StatMtimeFn = async (filePath: string) => {
      if (filePath === qmdIndexPath(HOME)) return 1000;
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

    const handlers = makeHandlers({ exec, home: HOME, statMtime });
    await handlers.search({ term: 'foo', type: 'semantic', collections }, noopLog);

    const updateIdx = calls.findIndex((c) => c.includes('update'));
    const embedIdx = calls.findIndex((c) => c.includes('embed'));
    const searchIdx = calls.findIndex((c) => c[1] === 'vsearch');
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
