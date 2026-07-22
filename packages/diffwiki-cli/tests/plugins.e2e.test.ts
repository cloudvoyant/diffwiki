import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './helpers';

let home: string;
let scriptDir: string;
let scriptPath: string;

/**
 * A real subprocess plugin implementing the diffwiki JSON-over-stdio protocol,
 * backed by an in-memory stub. Written to disk so the host spawns it for real.
 * `DIFFWIKI_FIXTURE_TOOL_MISSING=1` flips `health` to report its dependency
 * absent, exercising the doctor error path.
 */
const FIXTURE = `#!/usr/bin/env node
import { createInterface } from 'node:readline';

const toolMissing = process.env.DIFFWIKI_FIXTURE_TOOL_MISSING === '1';

function reply(id, result) {
  process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\\n');
}
function log(level, message) {
  process.stdout.write(JSON.stringify({ log: { level, message } }) + '\\n');
}

function handle(msg) {
  const { id, op, params } = msg;
  switch (op) {
    case 'initialize':
      reply(id, {
        name: 'stub',
        kind: 'search',
        version: '0.0.1',
        capabilities: { kind: 'search', searchTypes: ['stub'], collectionFilter: true, hooks: true, setup: true },
      });
      break;
    case 'setup':
      log('info', 'stub setup running');
      reply(id, { ready: true, steps: [{ step: 'stub-setup', ok: true }] });
      break;
    case 'index': {
      const n = Array.isArray(params && params.collections) ? params.collections.length : 0;
      reply(id, { indexed: n });
      break;
    }
    case 'notify':
      reply(id, { accepted: true });
      break;
    case 'search':
      reply(id, {
        hits: [
          {
            collection: 'stub',
            relPath: 'canned.md',
            title: 'stub hit for ' + ((params && params.term) || ''),
            snippet: 'a canned snippet',
            score: 1,
            docid: 'stub-1',
            tags: ['stub'],
          },
        ],
      });
      break;
    case 'health':
      if (toolMissing) {
        reply(id, {
          ready: false,
          readiness: {
            toolInstalled: false,
            modelsPresent: false,
            indexBuilt: false,
            docsIndexed: 0,
            embeddingsPending: 0,
            firstSearchCost: 'model-download',
          },
          diagnostics: [{ level: 'error', message: 'stub tool missing — install it' }],
        });
      } else {
        reply(id, {
          ready: true,
          readiness: {
            toolInstalled: true,
            modelsPresent: true,
            indexBuilt: true,
            docsIndexed: 1,
            embeddingsPending: 0,
            firstSearchCost: 'instant',
          },
          diagnostics: [{ level: 'ok', message: 'stub ready' }],
        });
      }
      break;
    case 'shutdown':
      reply(id, {});
      process.exit(0);
      break;
    default:
      process.stdout.write(JSON.stringify({ id, ok: false, error: { message: 'unknown op ' + op } }) + '\\n');
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(msg);
});
`;

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
  it('register → list → doctor → index → query → default routing → remove', async () => {
    // Seed a collection so setup/index/search have something to work with.
    expect((await run(['create', 'stub'])).ok).toBe(true);

    // register spawns the plugin, validates the handshake, and runs setup.
    const reg = await run(['plugin', 'register', 'stub', '--command', 'node', scriptPath]);
    expect(reg.ok).toBe(true);
    expect(reg.out).toContain('Registered "stub"');

    // list shows it enabled + spawnable.
    const list = await run(['plugin', 'list']);
    expect(list.ok).toBe(true);
    expect(list.out).toContain('stub');
    expect(list.out).toContain('enabled=true');
    expect(list.out).toContain('spawnable=true');

    // doctor folds in the plugin's health diagnostics + readiness line.
    const doc = await run(['doctor']);
    expect(doc.ok).toBe(true);
    expect(doc.out).toContain('plugin "stub" enabled and spawnable');
    expect(doc.out).toContain('stub ready');
    expect(doc.out).toContain('first search is instant');

    // index delegates to the plugin's reindex.
    const idx = await run(['index']);
    expect(idx.ok).toBe(true);
    expect(idx.out).toContain('Indexed');

    // query --engine stub round-trips the canned hit + snippet.
    const q = await run(['query', 'hello', '--engine', 'stub']);
    expect(q.ok).toBe(true);
    expect(q.out).toContain('1 result(s)');
    expect(q.out).toContain('stub hit for hello');
    expect(q.out).toContain('a canned snippet');

    // config-set defaultSearch stub → query with no --engine routes to the stub (core resolves).
    expect((await run(['config-set', 'defaultSearch', 'stub'])).ok).toBe(true);
    const q2 = await run(['query', 'hello']);
    expect(q2.ok).toBe(true);
    expect(q2.out).toContain('stub hit for hello');

    // remove deregisters; list no longer shows an enabled plugin.
    const rm = await run(['plugin', 'remove', 'stub']);
    expect(rm.ok).toBe(true);
    const listAfter = await run(['plugin', 'list']);
    expect(listAfter.out).not.toContain('enabled=true');
  });

  it('doctor surfaces the tool-missing diagnostic and exits non-zero', async () => {
    expect((await run(['create', 'stub'])).ok).toBe(true);
    expect((await run(['plugin', 'register', 'stub', '--command', 'node', scriptPath])).ok).toBe(true);

    // The child inherits parent env; flip the fixture into tool-missing mode.
    process.env.DIFFWIKI_FIXTURE_TOOL_MISSING = '1';
    const doc = await run(['doctor']);
    expect(doc.ok).toBe(false);
    expect(doc.out).toContain('stub tool missing');
  });

  it('doctor warns when defaultSearch points at an uninstalled engine', async () => {
    expect((await run(['create', 'stub'])).ok).toBe(true);
    // No plugin named "ghost" is installed; config-set stores it anyway (with a warn).
    expect((await run(['config-set', 'defaultSearch', 'ghost:semantic'])).ok).toBe(true);

    const doc = await run(['doctor']);
    expect(doc.out).toContain('defaultSearch "ghost:semantic" is not installed/enabled — using native');
  });
});
