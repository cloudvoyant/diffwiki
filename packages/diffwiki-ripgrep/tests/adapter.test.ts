// WHY fake spawners (and NEVER real rg/fzf) in unit tests:
// This suite tests the protocol mapping -- rg arg construction, plain-line parsing,
// fzf ranking, collection prefix matching, hit assembly, and fzf-aware setup/health.
// These are pure logic checks that must run in any CI environment (rg/fzf may not be
// installed). Real rg is gated to tests/ripgrep.e2e.test.ts with describe.skipIf.
import { describe, expect, it, vi } from 'vitest';
import { makePluginDefinition, matchCollection, type Collection } from '../src/bin.js';
import { parseRgLine, tokenize } from '../src/ripgrep.js';
import type { ReadFileFn, SpawnRgFn, SpawnFzfFn } from '../src/ripgrep.js';

const noopLog = () => {};

// Two collection roots -- one global, one in-repo wiki OUTSIDE ~/.diffwiki
const COLLECTIONS: Collection[] = [
  { name: 'global-wiki', path: '/home/user/.diffwiki/collections/global-wiki' },
  { name: 'repo-docs', path: '/workspace/my-repo/docs' },
];

/** Build a canned ripgrep plain stdout string (`path:line:text`). */
function cannedRgOutput(matches: Array<{ filePath: string; lineText: string; lineNumber?: number }>): string {
  return matches.map((m) => `${m.filePath}:${m.lineNumber ?? 1}:${m.lineText}`).join('\n') + '\n';
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

/** Fake fzf. Default: identity (keeps ripgrep order). Pass a transform to reorder/filter. */
function fakeFzf(transform: (input: string) => string = (i) => i): {
  fzfFn: SpawnFzfFn;
  calls: Array<{ args: string[]; input: string }>;
} {
  const calls: Array<{ args: string[]; input: string }> = [];
  const fzfFn: SpawnFzfFn = async (args, input) => {
    calls.push({ args, input });
    return transform(input);
  };
  return { fzfFn, calls };
}

/** An fzf spawner that is "not installed" — always throws (like a missing binary). */
const missingFzf: SpawnFzfFn = async () => {
  throw new Error('command not found: fzf');
};

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
    expect(matchCollection('/some/other/path/file.md', COLLECTIONS)).toBeNull();
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
// tokenize + parseRgLine
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('splits into lowercased word tokens, dropping punctuation', () => {
    expect(tokenize('New TS CLI, command!')).toEqual(['new', 'ts', 'cli', 'command']);
  });
  it('returns [] when there are no word characters', () => {
    expect(tokenize('  -- ??  ')).toEqual([]);
  });
});

describe('parseRgLine', () => {
  it('parses path:line:text', () => {
    expect(parseRgLine('/a/b.md:12:some text')).toEqual({ path: '/a/b.md', lineNumber: 12, text: 'some text' });
  });
  it('keeps colons in the matched text', () => {
    expect(parseRgLine('/a.md:3:key: value: pairs')).toEqual({
      path: '/a.md',
      lineNumber: 3,
      text: 'key: value: pairs',
    });
  });
  it('returns null for a line without the path:line: prefix', () => {
    expect(parseRgLine('not a match line')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// search handler -- ripgrep arg construction
// ---------------------------------------------------------------------------

describe('search handler -- arg construction', () => {
  it('builds an OR-alternation -e pattern from query tokens (no --fixed-strings)', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    await handlers.search({ term: 'hello world', collections: COLLECTIONS, type: 'fuzzy' }, noopLog);
    expect(calls).toHaveLength(1);
    const eIdx = calls[0].indexOf('-e');
    expect(eIdx).toBeGreaterThan(-1);
    expect(calls[0][eIdx + 1]).toBe('hello|world');
    expect(calls[0]).toContain('--smart-case');
    expect(calls[0]).not.toContain('--fixed-strings');
    expect(calls[0]).toContain('--glob');
  });

  it('passes --max-count with the requested limit', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    await handlers.search({ term: 'foo', collections: COLLECTIONS, limit: 20 }, noopLog);
    const idx = calls[0].indexOf('--max-count');
    expect(idx).toBeGreaterThan(-1);
    expect(calls[0][idx + 1]).toBe('20');
  });

  it('includes both collection roots when no collection filter is set', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    await handlers.search({ term: 'foo', collections: COLLECTIONS }, noopLog);
    expect(calls[0]).toContain(COLLECTIONS[0].path);
    expect(calls[0]).toContain(COLLECTIONS[1].path);
  });

  it('collection filter restricts roots to the named collection only', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    await handlers.search({ term: 'foo', collections: COLLECTIONS, collection: 'repo-docs' }, noopLog);
    expect(calls[0]).toContain(COLLECTIONS[1].path);
    expect(calls[0]).not.toContain(COLLECTIONS[0].path);
  });

  it('skips ripgrep entirely for a query with no word tokens', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search({ term: '   ', collections: COLLECTIONS }, noopLog);
    expect(result.hits).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// search handler -- fzf ranking + hit assembly
// ---------------------------------------------------------------------------

describe('search handler -- fzf ranking + hit assembly', () => {
  it('maps ranked lines across two roots to correct collection/relPath/snippet', async () => {
    const stdout = cannedRgOutput([
      { filePath: '/home/user/.diffwiki/collections/global-wiki/guide/intro.md', lineText: 'This is the intro.' },
      { filePath: '/workspace/my-repo/docs/api/overview.md', lineText: 'API overview here.' },
    ]);
    const { spawnFn } = fakeSpawn(stdout);
    const { fzfFn } = fakeFzf(); // identity → keeps rg order
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search({ term: 'intro', collections: COLLECTIONS }, noopLog);

    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({
      collection: 'global-wiki',
      relPath: 'guide/intro.md',
      snippet: 'This is the intro.',
      title: 'My Title',
    });
    expect(result.hits[1]).toMatchObject({ collection: 'repo-docs', relPath: 'api/overview.md' });
  });

  it('orders hits by fzf ranking (not ripgrep order)', async () => {
    const stdout = cannedRgOutput([
      { filePath: '/workspace/my-repo/docs/a.md', lineText: 'alpha' },
      { filePath: '/workspace/my-repo/docs/b.md', lineText: 'beta' },
    ]);
    const { spawnFn } = fakeSpawn(stdout);
    // fzf reverses order → b.md should rank first.
    const { fzfFn, calls } = fakeFzf((input) => input.trim().split('\n').reverse().join('\n'));
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search(
      { term: 'alpha beta', collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }] },
      noopLog,
    );
    expect(result.hits.map((h) => h.relPath)).toEqual(['b.md', 'a.md']);
    // fzf was called with the full query and the rg candidates as stdin.
    expect(calls[0].args).toEqual(['--filter', 'alpha beta']);
    // rank-derived scores: best hit = 1, descending.
    expect(result.hits.map((h) => h.score)).toEqual([1, 0.5]);
  });

  it('falls back to ripgrep order (and omits scores) when fzf is missing', async () => {
    const stdout = cannedRgOutput([
      { filePath: '/workspace/my-repo/docs/a.md', lineText: 'first' },
      { filePath: '/workspace/my-repo/docs/b.md', lineText: 'second' },
    ]);
    const { spawnFn } = fakeSpawn(stdout);
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn: missingFzf, readFn: fakeReadFn });
    const result = await handlers.search(
      { term: 'first second', collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }] },
      noopLog,
    );
    expect(result.hits.map((h) => h.relPath)).toEqual(['a.md', 'b.md']);
    // plain-ripgrep order isn't relevance, so no scores are assigned.
    expect(result.hits.every((h) => h.score === undefined)).toBe(true);
  });

  it('keeps ripgrep candidates when fzf finds no full match (empty fzf output)', async () => {
    const stdout = cannedRgOutput([{ filePath: '/workspace/my-repo/docs/a.md', lineText: 'partial' }]);
    const { spawnFn } = fakeSpawn(stdout);
    const { fzfFn } = fakeFzf(() => ''); // fzf: no line matches the whole query
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search(
      { term: 'partial nomatch', collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }] },
      noopLog,
    );
    expect(result.hits.map((h) => h.relPath)).toEqual(['a.md']);
  });

  it('dedupes hits by file path (keeps first/best occurrence)', async () => {
    const stdout = cannedRgOutput([
      { filePath: '/workspace/my-repo/docs/readme.md', lineText: 'line one' },
      { filePath: '/workspace/my-repo/docs/readme.md', lineText: 'line two' },
    ]);
    const { spawnFn } = fakeSpawn(stdout);
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search(
      { term: 'line', collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }] },
      noopLog,
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].snippet).toBe('line one');
  });

  it('caps hits at the requested limit', async () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({
      filePath: `/workspace/my-repo/docs/file${i}.md`,
      lineText: `content ${i}`,
    }));
    const { spawnFn } = fakeSpawn(cannedRgOutput(matches));
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search(
      { term: 'content', collections: [{ name: 'repo-docs', path: '/workspace/my-repo/docs' }], limit: 3 },
      noopLog,
    );
    expect(result.hits).toHaveLength(3);
  });

  it('returns {hits:[]} when ripgrep returns empty stdout (no matches)', async () => {
    const { spawnFn } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.search({ term: 'nothing', collections: COLLECTIONS }, noopLog);
    expect(result.hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// health handler -- fzf aware
// ---------------------------------------------------------------------------

describe('health handler', () => {
  it('returns ready:false and an error diagnostic when rg is absent', async () => {
    const { spawnFn } = fakeSpawn(new Error('command not found: rg'));
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(false);
    expect(result.readiness!.toolInstalled).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].level).toBe('error');
    expect(result.diagnostics[0].message).toContain('ripgrep');
  });

  it('reports rg + fzf ok when both are present', async () => {
    const { spawnFn } = fakeSpawn('ripgrep 14.1.1');
    const { fzfFn } = fakeFzf(); // resolves the --version probe → present
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(true);
    expect(result.readiness!.toolInstalled).toBe(true);
    expect(result.diagnostics.map((d) => d.level)).toEqual(['ok', 'ok']);
    expect(result.diagnostics.some((d) => /fzf ready/.test(d.message))).toBe(true);
  });

  it('warns (but stays ready) when rg is present but fzf is missing', async () => {
    const { spawnFn } = fakeSpawn('ripgrep 14.1.1');
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn: missingFzf, readFn: fakeReadFn });
    const result = await handlers.health({ collections: [] }, noopLog);

    expect(result.ready).toBe(true);
    const fzfDiag = result.diagnostics.find((d) => /fzf/.test(d.message));
    expect(fzfDiag?.level).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// setup handler -- fzf aware
// ---------------------------------------------------------------------------

describe('setup handler', () => {
  // Fake installer: reports each tool's presence (and optional install method)
  // and records which specs it was asked to install.
  function fakeInstall(presence: Record<string, { present: boolean; installed?: boolean; method?: 'mise' | 'brew' }>): {
    installFn: NonNullable<Parameters<typeof makePluginDefinition>[0]>['installFn'];
    installed: string[];
  } {
    const installed: string[] = [];
    const installFn: NonNullable<Parameters<typeof makePluginDefinition>[0]>['installFn'] = async (spec, opts) => {
      if (opts?.install) installed.push(spec.command);
      const p = presence[spec.command] ?? { present: false };
      return {
        command: spec.command,
        present: p.present,
        installed: p.installed ?? false,
        method: p.method,
        message: p.installed
          ? `installed ${spec.command} via ${p.method}`
          : p.present
            ? `${spec.command} present`
            : `${spec.command} not found — ${spec.manual}`,
      };
    };
    return { installFn, installed };
  }

  it('returns ready:false and a failed verify-rg step when rg cannot be installed', async () => {
    const log = vi.fn();
    const { installFn } = fakeInstall({ rg: { present: false } });
    const { handlers } = makePluginDefinition({ installFn, readFn: fakeReadFn });
    const result = await handlers.setup({ collections: [] }, log);

    expect(result.ready).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps![0]).toMatchObject({ step: 'verify-rg', ok: false });
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('ripgrep'));
  });

  it('attempts to install both rg and fzf and reports ok when present', async () => {
    const { installFn, installed } = fakeInstall({ rg: { present: true }, fzf: { present: true } });
    const { handlers } = makePluginDefinition({ installFn, readFn: fakeReadFn });
    const result = await handlers.setup({ collections: [] }, noopLog);

    expect(installed).toEqual(['rg', 'fzf']); // both install attempts were made
    expect(result.ready).toBe(true);
    expect(result.steps?.find((s) => s.step === 'verify-rg')?.ok).toBe(true);
    expect(result.steps?.find((s) => s.step === 'verify-fzf')?.ok).toBe(true);
  });

  it('surfaces the install method when a tool was just installed', async () => {
    const { installFn } = fakeInstall({
      rg: { present: true },
      fzf: { present: true, installed: true, method: 'brew' },
    });
    const { handlers } = makePluginDefinition({ installFn, readFn: fakeReadFn });
    const result = await handlers.setup({ collections: [] }, noopLog);
    expect(result.steps?.find((s) => s.step === 'verify-fzf')?.message).toContain('via brew');
  });

  it('stays ready but flags verify-fzf when fzf cannot be installed', async () => {
    const log = vi.fn();
    const { installFn } = fakeInstall({ rg: { present: true }, fzf: { present: false } });
    const { handlers } = makePluginDefinition({ installFn, readFn: fakeReadFn });
    const result = await handlers.setup({ collections: [] }, log);

    expect(result.ready).toBe(true);
    expect(result.steps?.find((s) => s.step === 'verify-fzf')).toMatchObject({ ok: false });
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('fzf'));
  });
});

// ---------------------------------------------------------------------------
// index and onEvent handlers (no-ops)
// ---------------------------------------------------------------------------

describe('index handler', () => {
  it('returns {indexed:0} and never calls the spawner', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.index({ collections: COLLECTIONS }, noopLog);
    expect(result.indexed).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('onEvent handler', () => {
  it('returns {accepted:true} and never calls the spawner', async () => {
    const { spawnFn, calls } = fakeSpawn('');
    const { fzfFn } = fakeFzf();
    const { handlers } = makePluginDefinition({ spawnFn, fzfFn, readFn: fakeReadFn });
    const result = await handlers.onEvent(
      { event: 'article-updated', collection: { name: 'repo-docs', path: '/workspace/my-repo/docs' }, collections: [] },
      noopLog,
    );
    expect(result.accepted).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// describe (via definePlugin)
// ---------------------------------------------------------------------------

describe('describe via definePlugin', () => {
  it('returns correct name/kind/version and a single fuzzy capability', () => {
    const { definition } = makePluginDefinition({});
    expect(definition.name).toBe('diffwiki-ripgrep');
    expect(definition.kind).toBe('search');
    expect(definition.version).toBe('0.4.0');
    expect(definition.capabilities.searchTypes).toEqual(['fuzzy']);
    expect(definition.capabilities.collectionFilter).toBe(true);
    expect(definition.capabilities.events).toBe(false);
  });
});
