// WHY a fake execFile (and NEVER real qmd) in CI:
// `@tobilu/qmd` pulls in native binaries (node-llama-cpp, better-sqlite3) that are
// built/downloaded at install time, and its vector/hybrid search downloads multi-GB
// GGUF models from HuggingFace on first use. Running real qmd here would make the
// suite slow, network-dependent, and flaky. Every test injects a canned `ExecFileFn`
// so the adapter's op -> CLI mapping and JSON parsing are exercised in isolation.
import { describe, expect, it, vi } from 'vitest';
import { makeHandlers, searchSubcommand, splitQmdPath, type QmdRow } from '../src/bin.js';
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
        return {
          stdout: JSON.stringify({
            totalDocuments: 128,
            needsEmbedding: 0,
            hasVectorIndex: true,
            collections: [],
          }),
        };
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
