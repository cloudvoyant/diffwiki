import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;
let scriptDir: string;
let scriptPath: string;

/**
 * A real one-shot subprocess plugin implementing the diffwiki protocol.
 * Reads one JSON request from stdin, responds on stdout, and exits.
 * `DIFFWIKI_FIXTURE_TOOL_MISSING=1` flips `health` to report its dependency absent.
 */
const FIXTURE = `#!/usr/bin/env node
const toolMissing = process.env.DIFFWIKI_FIXTURE_TOOL_MISSING === '1';

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { buffer += chunk; });
process.stdin.on('end', () => {
  const line = buffer.trim();
  if (!line) { process.exit(1); return; }
  const msg = JSON.parse(line);
  const result = handle(msg.op, msg.params || {});
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\\n');
  process.exit(0);
});

function handle(op, params) {
  switch (op) {
    case 'describe':
      return {
        name: 'stub',
        kind: 'search',
        version: '0.0.1',
        capabilities: { searchTypes: ['stub'], collectionFilter: true, events: true },
      };
    case 'setup':
      return { ready: true, steps: [{ step: 'stub-setup', ok: true }] };
    case 'index': {
      const n = Array.isArray(params.collections) ? params.collections.length : 0;
      return { indexed: n };
    }
    case 'event':
      return { accepted: true };
    case 'search':
      return {
        hits: [{
          collection: 'stub',
          relPath: 'canned.md',
          title: 'stub hit for ' + (params.term || ''),
          snippet: 'a canned snippet',
          score: 1,
          docid: 'stub-1',
          tags: ['stub'],
        }],
      };
    case 'health':
      if (toolMissing) {
        return {
          ready: false,
          readiness: {
            toolInstalled: false, modelsPresent: false, indexBuilt: false,
            docsIndexed: 0, embeddingsPending: 0, firstSearchCost: 'model-download',
          },
          diagnostics: [{ level: 'error', message: 'stub tool missing — install it' }],
        };
      }
      return {
        ready: true,
        readiness: {
          toolInstalled: true, modelsPresent: true, indexBuilt: true,
          docsIndexed: 1, embeddingsPending: 0, firstSearchCost: 'instant',
        },
        diagnostics: [{ level: 'ok', message: 'stub ready' }],
      };
    default:
      throw new Error('unknown op ' + op);
  }
}
`;

/** Probe for rg on PATH at module load time. */
const rgOnPath = (() => {
  try {
    execSync('rg --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Probe for qmd on PATH at module load time. */
const qmdOnPath = (() => {
  try {
    execSync('qmd --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Absolute path to the built diffwiki-ripgrep bin. */
const RIPGREP_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../diffwiki-ripgrep/dist/bin.js');

/** Absolute path to the built diffwiki-qmd bin. */
const QMD_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../diffwiki-qmd/dist/bin.js');

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-plugin-e2e-'));
  scriptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-fixture-'));
  // Resolve symlinks (important on macOS where /tmp is a symlink to /private/tmp).
  home = await fs.realpath(home);
  scriptDir = await fs.realpath(scriptDir);
  scriptPath = path.join(scriptDir, 'stub-plugin.mjs');
  await fs.writeFile(scriptPath, FIXTURE, 'utf8');
  process.env.DIFFWIKI_HOME = home;
});

afterEach(async () => {
  delete process.env.DIFFWIKI_HOME;
  delete process.env.DIFFWIKI_FIXTURE_TOOL_MISSING;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(scriptDir, { recursive: true, force: true });
});

describe('plugin lifecycle (fixture subprocess plugin, no npm/network)', () => {
  it('register -> list -> doctor -> index -> query -> default routing -> remove', async () => {
    expect((await run(['create', 'stub'])).ok).toBe(true);

    const reg = await run(['plugin', 'register', 'stub', '--command', 'node', scriptPath]);
    expect(reg.ok).toBe(true);
    expect(reg.out).toContain('Registered "stub"');

    const list = await run(['plugin', 'list']);
    expect(list.ok).toBe(true);
    expect(list.out).toContain('stub');
    expect(list.out).toContain('enabled=true');
    expect(list.out).toContain('spawnable=true');

    const doc = await run(['doctor']);
    expect(doc.ok).toBe(true);
    expect(doc.out).toContain('plugin "stub" enabled and spawnable');
    expect(doc.out).toContain('stub ready');
    expect(doc.out).toContain('first search is instant');

    const idx = await run(['index']);
    expect(idx.ok).toBe(true);
    expect(idx.out).toContain('Indexed');

    const q = await run(['query', 'hello', '--engine', 'stub']);
    expect(q.ok).toBe(true);
    expect(q.out).toContain('1 result(s)');
    expect(q.out).toContain('stub hit for hello');
    expect(q.out).toContain('a canned snippet');

    expect((await run(['config-set', 'defaultSearch', 'stub'])).ok).toBe(true);
    const q2 = await run(['query', 'hello']);
    expect(q2.ok).toBe(true);
    expect(q2.out).toContain('stub hit for hello');

    const rm = await run(['plugin', 'remove', 'stub']);
    expect(rm.ok).toBe(true);
    const listAfter = await run(['plugin', 'list']);
    expect(listAfter.out).not.toContain('enabled=true');
  });

  it('doctor surfaces the tool-missing diagnostic and exits non-zero', async () => {
    expect((await run(['create', 'stub'])).ok).toBe(true);
    expect((await run(['plugin', 'register', 'stub', '--command', 'node', scriptPath])).ok).toBe(true);

    process.env.DIFFWIKI_FIXTURE_TOOL_MISSING = '1';
    const doc = await run(['doctor']);
    expect(doc.ok).toBe(false);
    expect(doc.out).toContain('stub tool missing');
  });

  it('doctor warns when defaultSearch points at an uninstalled engine', async () => {
    expect((await run(['create', 'stub'])).ok).toBe(true);
    expect((await run(['config-set', 'defaultSearch', 'ghost:semantic'])).ok).toBe(true);

    const doc = await run(['doctor']);
    expect(doc.out).toContain('defaultSearch "ghost:semantic" is not installed/enabled — using native');
  });

  it('list shows the available plugin catalog even with none installed', async () => {
    const list = await run(['plugin', 'list']);
    expect(list.ok).toBe(true);
    expect(list.out).toContain('Installed:');
    expect(list.out).toContain('(none)');
    expect(list.out).toContain('Available');
    expect(list.out).toContain('diffwiki-qmd');
    expect(list.out).toContain('diffwiki-ripgrep');
  });
});

describe.skipIf(!rgOnPath)('real ripgrep plugin e2e (rg on PATH)', () => {
  let externalDir: string;

  it('register -> query -> doctor round-trip with real rg', async () => {
    execSync('pnpm --filter diffwiki-ripgrep run build', {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
      stdio: 'ignore',
    });

    expect((await run(['create', 'rg-test'])).ok).toBe(true);
    const collDir = path.join(home, 'collections', 'rg-test');
    await fs.writeFile(
      path.join(collDir, 'searchable.md'),
      '---\ntitle: The Quick Brown Fox\ntags:\n  - animals\n---\n\nThe quick brown fox jumps over the lazy dog.\n',
      'utf8',
    );

    externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-rg-external-'));
    externalDir = await fs.realpath(externalDir);
    await fs.writeFile(
      path.join(externalDir, 'external-note.md'),
      '---\ntitle: External Quick Note\ntags: []\n---\n\nThis external note also mentions quick brown fox.\n',
      'utf8',
    );
    const origCwd = process.cwd();
    try {
      process.chdir(externalDir);
      await run(['init', '--collection', 'external-rg', '--path', '.']);
    } finally {
      process.chdir(origCwd);
    }

    const reg = await run(['plugin', 'register', 'diffwiki-ripgrep', '--command', 'node', RIPGREP_BIN]);
    expect(reg.ok).toBe(true);
    expect(reg.out).toContain('Registered "diffwiki-ripgrep"');

    const q = await run(['query', 'quick brown fox', '--engine', 'diffwiki-ripgrep']);
    expect(q.ok).toBe(true);
    expect(q.out).toContain('result(s)');
    expect(q.out).toContain('Quick Brown Fox');

    const doc = await run(['doctor']);
    expect(doc.ok).toBe(true);
    expect(doc.out).toContain('plugin "diffwiki-ripgrep" enabled and spawnable');
    expect(doc.out).toContain('ripgrep ready');

    const rm = await run(['plugin', 'remove', 'diffwiki-ripgrep']);
    expect(rm.ok).toBe(true);

    if (externalDir) {
      await fs.rm(externalDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!(process.env.DIFFWIKI_E2E_REAL && qmdOnPath))(
  'real qmd plugin e2e (DIFFWIKI_E2E_REAL + qmd on PATH)',
  () => {
    it('register -> index -> keyword query round-trip with real qmd', async () => {
      execSync('pnpm --filter diffwiki-qmd run build', {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
        stdio: 'ignore',
      });

      expect((await run(['create', 'qmd-test'])).ok).toBe(true);
      const collDir = path.join(home, 'collections', 'qmd-test');
      await fs.writeFile(
        path.join(collDir, 'qmd-article.md'),
        '---\ntitle: Quantum Computing Basics\ntags:\n  - physics\n  - computing\n---\n\nQuantum computing uses qubits instead of classical bits.\n',
        'utf8',
      );

      const reg = await run(['plugin', 'register', 'diffwiki-qmd', '--command', 'node', QMD_BIN]);
      expect(reg.ok).toBe(true);
      expect(reg.out).toContain('Registered "diffwiki-qmd"');

      const idx = await run(['index']);
      expect(idx.ok).toBe(true);
      expect(idx.out).toContain('Indexed');

      const q = await run(['query', 'quantum', '--engine', 'diffwiki-qmd', '-t', 'keyword']);
      expect(q.ok).toBe(true);
      expect(q.out).toContain('result(s)');
      expect(q.out).toContain('Quantum');

      const doc = await run(['doctor']);
      expect(doc.ok).toBe(true);
      expect(doc.out).toContain('plugin "diffwiki-qmd" enabled and spawnable');

      const rm = await run(['plugin', 'remove', 'diffwiki-qmd']);
      expect(rm.ok).toBe(true);
    });
  },
);
