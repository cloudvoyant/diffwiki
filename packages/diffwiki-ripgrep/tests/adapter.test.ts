// WHY a fake SpawnRgFn (and NEVER real rg) in unit tests:
// This suite tests the protocol mapping -- arg construction, JSON-line parsing, collection
// prefix matching, hit assembly. These are pure logic checks that must run in
// any CI environment (rg may not be installed). Real rg is gated to tests/ripgrep.e2e.test.ts
// which uses `describe.skipIf(!rgPresent)` so it skips cleanly when rg is absent.
import { describe, expect, it, vi } from 'vitest';
import { makePluginDefinition, matchCollection, parseRgOutput, type Collection } from '../src/bin.js';
import type { ReadFileFn, SpawnRgFn } from '../src/ripgrep.js';

const noopLog = () => {};

// Two collection roots -- one global, one in-repo wiki OUTSIDE ~/.diffwiki
const COLLECTIONS: Collection[] = [
  { name: 'global-wiki', path: '/home/user/.diffwiki/collections/global-wiki' },
  { name: 'repo-docs', path: '/workspace/my-repo/docs' },
];

/** Build a canned rg --json stdout string from an array of file paths and snippets. */
function cannedRgOutput(matches: Array<{ filePath: string; lineText: string; lineNumber?: number }>): string {
  const lines = matches.map((m) =>
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: m.filePath },
        lines: { text: m.lineText },
        line_number: m.lineNumber ?? 1,
        absolute_offset: 0,
        submatches: [],
      },
    }),
  );
  return lines.join('\n') + '\n';
}

function fakeSpawn(stdout: string | Error): { spawnFn: SpawnRgFn; calls: string[][] } {
  const calls: string[][] = [];
  const spawnFn: SpawnRgFn = async (args) => {
    calls.push(args);
    if (stdout instanceof Error) throw stdout;
    return stdout;
  };
  return { spawnFn, calls };
}

const fakeReadFn: ReadFileFn = async () => ['# My Title', '', 'Some content here.'];

// ---------------------------------------------------------------------------
// matchCollection
// ---------------------------------------------------------------------------

describe('matchCollection', () => {
  it('matches a file under global-wiki to the correct collection and relPath', () => {
    const result = matchCollection('/home/user/.diffwiki/collections/global-wiki/guide/intro.md', COLLECTIONS);
    expect(result).toEqual({ collection: 'global-wiki', relPath: 'guide/intro.md' });
  });

  it('matches a file under in-repo docs path outside ~/.diffwiki', () => {
    const result = matchCollection('/workspace/my-repo/docs/api/overview.md', COLLECTIONS);
    expect(result).toEqual({ collection: 'repo-docs', relPath: 'api/overview.md' });
  });

  it('returns null for a path that does not match any collection root', () => {
    const result = matchCollection('/some/other/path/file.md', COLLECTIONS);
    expect(result).toBeNull();
  });

  it('resolves ambiguity by longest-prefix-first', () => {
    const ambiguous: Collection[] = [
      { name: 'short', path: '/workspace/my-repo' },
      { name: 'long', path: '/workspace/my-repo/docs' },
    ];
    const result = matchCollection('/workspace/my-repo/docs/readme.md', ambiguous);
    expect(result).toEqual({ collection: 'long', relPath: 'readme.md' });
  });
});

// ---------------------------------------------------------------------------
// parseRgOutput
// ---------------------------------------------------------------------------

describe('parseRgOutput', () => {
  it('keeps only match events and ignores begin/end/summary events', () => {
    const lines = [
      JSON.stringify({ type: 'begin', data: { path: { text: '/foo/bar.md' } } }),
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: '/foo/bar.md' },
          lines: { text: 'hello world' },
          line_number: 3,
        },
      }),
      JSON.stringify({ type: 'end', data: {} }),
      JSON.stringify({ type: 'summary', data: {} }),
    ].join('\n');
    const events = parseRgOutput(lines);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('match');
  });

  it('skips malformed (non-JSON) lines without throwing', () => {
    const lines = [
      'not json at all',
      JSON.stringify({
        type: 'match',
        data: { path: { text: '/x.md' }, lines: { text: 'hi' }, line_number: 1 },
      }),
    ].join('\n');
    const events = parseRgOutput(lines);
    expect(events).toHaveLength(1);
  });

  it('returns empty array for empty stdout', () => {
    expect(parseRgOutput('')).toEqual([]);
    expect(parseRgOutput('\n\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// search handler
// ---------------------------------------------------------------------------

describe('search handler -- arg construction', () => {
  it('type:text passes --fixed-strings and -i', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    await handlers.search({ term: 'hello', collections: COLLECTIONS, type: 'text' }, noopLog);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--fixed-strings');
    expect(calls[0]).toContain('-i');
  });

  it('type:regex does NOT pass --fixed-strings', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    await handlers.search({ term: 'hell+o', collections: COLLECTIONS, type: 'regex' }, noopLog);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('--fixed-strings');
  });

  it('passes --max-count with default limit 20', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    await handlers.search({ term: 'foo', collections: COLLECTIONS }, noopLog);
    const idx = calls[0].indexOf('--max-count');
    expect(idx).toBeGreaterThan(-1);
    expect(calls[0][idx + 1]).toBe('20');
  });

  it('includes both collection roots when no collection filter is set', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    await handlers.search({ term: 'foo', collections: COLLECTIONS }, noopLog);
    expect(calls[0]).toContain(COLLECTIONS[0].path);
    expect(calls[0]).toContain(COLLECTIONS[1].path);
  });

  it('collection filter restricts roots to the named collection only', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    await handlers.search({ term: 'foo', collections: COLLECTIONS, collection: 'repo-docs' }, noopLog);
    expect(calls[0]).toContain(COLLECTIONS[1].path);
    expect(calls[0]).not.toContain(COLLECTIONS[0].path);
  });
});

describe('search handler -- hit assembly', () => {
  it('maps two match events across two roots to correct collection/relPath/snippet', async () => {
    const stdout = cannedRgOutput([
      {
        filePath: '/home/user/.diffwiki/collections/global-wiki/guide/intro.md',
        lineText: 'This is the intro.',
      },
      {
        filePath: '/workspace/my-repo/docs/api/overview.md',
        lineText: 'API overview here.',
      },
    ]);
    const { spawnFn } = fakeSpawn(stdout);
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.search({ term: 'intro', collections: COLLECTIONS }, noopLog);

    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({
      collection: 'global-wiki',
      relPath: 'guide/intro.md',
      snippet: 'This is the intro.',
      title: 'My Title',
    });
    expect(result.hits[1]).toMatchObject({
      collection: 'repo-docs',
      relPath: 'api/overview.md',
      snippet: 'API overview here.',
      title: 'My Title',
    });
  });

  it('dedupes hits by file path (keeps first occurrence)', async () => {
    const stdout = cannedRgOutput([
      { filePath: '/workspace/my-repo/docs/readme.md', lineText: 'line one' },
      { filePath: '/workspace/my-repo/docs/readme.md', lineText: 'line two' },
    ]);
    const { spawnFn } = fakeSpawn(stdout);
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.search(
      { term: 'line', collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }] },
      noopLog,
    );
    expect(result.hits).toHaveLength(1);
  });

  it('caps hits at the requested limit', async () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({
      filePath: `/workspace/my-repo/docs/file${i}.md`,
      lineText: `content ${i}`,
    }));
    const stdout = cannedRgOutput(matches);
    const { spawnFn } = fakeSpawn(stdout);
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.search(
      {
        term: 'content',
        collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }],
        limit: 3,
      },
      noopLog,
    );
    expect(result.hits).toHaveLength(3);
  });

  it('returns {hits:[]} when spawner returns empty stdout (no matches)', async () => {
    const { spawnFn } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.search({ term: 'nothing', collections: COLLECTIONS }, noopLog);
    expect(result.hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// health handler
// ---------------------------------------------------------------------------

describe('health handler', () => {
  it('returns ready:false and error diagnostic when rg is absent', async () => {
    const { spawnFn } = fakeSpawn(new Error('command not found: rg'));
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(false);
    expect(result.readiness!.toolInstalled).toBe(false);
    expect(result.readiness!.firstSearchCost).toBe('instant');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].level).toBe('error');
    expect(result.diagnostics[0].message).toContain('ripgrep');
  });

  it('returns ready:true and ok diagnostic when rg is present', async () => {
    const { spawnFn } = fakeSpawn('ripgrep 14.1.1');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(true);
    expect(result.readiness!.toolInstalled).toBe(true);
    expect(result.readiness!.modelsPresent).toBe(true);
    expect(result.readiness!.indexBuilt).toBe(true);
    expect(result.readiness!.docsIndexed).toBe(0);
    expect(result.readiness!.embeddingsPending).toBe(0);
    expect(result.readiness!.firstSearchCost).toBe('instant');
    expect(result.diagnostics[0].level).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// setup handler
// ---------------------------------------------------------------------------

describe('setup handler', () => {
  it('returns ready:false and failed verify-rg step when rg absent', async () => {
    const { spawnFn } = fakeSpawn(new Error('not found'));
    const log = vi.fn();
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.setup({ collections: [] }, log);

    expect(result.ready).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps![0]).toMatchObject({ step: 'verify-rg', ok: false });
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('ripgrep'));
  });

  it('returns ready:true and ok verify-rg step when rg present', async () => {
    const { spawnFn } = fakeSpawn('ripgrep 14.1.1');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.setup({ collections: [] }, noopLog);

    expect(result.ready).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps![0]).toMatchObject({ step: 'verify-rg', ok: true });
  });
});

// ---------------------------------------------------------------------------
// index and onEvent handlers (no-ops)
// ---------------------------------------------------------------------------

describe('index handler', () => {
  it('returns {indexed:0} and never calls the spawner', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.index({ collections: COLLECTIONS }, noopLog);
    expect(result.indexed).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('onEvent handler', () => {
  it('returns {accepted:true} and never calls the spawner', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { handlers } = makePluginDefinition({ spawnFn, readFn: fakeReadFn });
    const result = await handlers.onEvent(
      {
        event: 'article-updated',
        collection: { name: 'repo-docs', path: '/workspace/my-repo/docs' },
        collections: [],
      },
      noopLog,
    );
    expect(result.accepted).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// describe (via definePlugin -- replaces initialize handler test)
// ---------------------------------------------------------------------------

describe('describe via definePlugin', () => {
  it('returns correct name/kind/version and capabilities', () => {
    const { definition } = makePluginDefinition({});

    expect(definition.name).toBe('diffwiki-ripgrep');
    expect(definition.kind).toBe('search');
    expect(definition.version).toBe('0.3.0');
    expect(definition.capabilities.searchTypes).toEqual(['text', 'regex']);
    expect(definition.capabilities.collectionFilter).toBe(true);
    expect(definition.capabilities.events).toBe(false);
  });
});
