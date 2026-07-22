// Gated real e2e: skipped when `rg` is not on PATH (`describe.skipIf(!rgPresent)`).
// When rg IS present, spawns the built dist/bin.js as a subprocess and drives the
// full initialize->search round-trip over stdio to prove the real rg integration.
// Integration note: `diffwiki plugin register diffwiki-ripgrep --command "node <binPath>"`
// makes this plugin appear in `listSearchModes()` once registered with diffwiki.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rgOnPath, spawnRg } from '../src/ripgrep.js';

// Probe rg at module load — determines whether the suite runs or skips.
const rgPresent = await rgOnPath(spawnRg);

const BIN_PATH = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

interface RgResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

/**
 * Write one JSON-lines request to `proc.stdin` and read stdout lines until the
 * matching response `id` is found. Log lines (no `id`) are collected and ignored
 * for assertion purposes.
 */
async function sendRequest(
  proc: ReturnType<typeof spawn>,
  id: number,
  op: string,
  params: Record<string, unknown> = {},
): Promise<RgResponse> {
  return new Promise<RgResponse>((resolve, reject) => {
    const req = JSON.stringify({ id, op, params }) + '\n';
    let buffer = '';

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            // Skip log lines (they have no `id`)
            if ('log' in obj) {
              nl = buffer.indexOf('\n');
              continue;
            }
            const res = obj as unknown as RgResponse;
            if (res.id === id) {
              proc.stdout!.off('data', onData);
              proc.stdout!.off('error', reject);
              resolve(res);
              return;
            }
          } catch {
            // Malformed line — skip
          }
        }
        nl = buffer.indexOf('\n');
      }
    };

    proc.stdout!.on('data', onData);
    proc.stdout!.on('error', reject);
    proc.stdin!.write(req, (err) => {
      if (err) reject(err);
    });
  });
}

describe.skipIf(!rgPresent)('ripgrep e2e — real rg subprocess', () => {
  let tmpDir: string;
  let collectionDir: string;
  let proc: ReturnType<typeof spawn>;

  beforeAll(async () => {
    // Create temp collection with a seeded md file
    tmpDir = await mkdtemp(join(tmpdir(), 'diffwiki-ripgrep-e2e-'));
    collectionDir = join(tmpDir, 'mycollection');
    await mkdir(collectionDir, { recursive: true });
    await writeFile(
      join(collectionDir, 'notes.md'),
      '# Quick Notes\n\nthe quick brown fox jumps over the lazy dog\n',
      'utf8',
    );

    // Spawn the built bin — drives it as an external subprocess exactly as the host would
    proc = spawn('node', [BIN_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr!.on('data', (chunk: Buffer) => {
      // Surface stderr for debugging if the test fails
      process.stderr.write(`[diffwiki-ripgrep bin stderr] ${chunk.toString()}`);
    });
  });

  afterAll(async () => {
    // Graceful shutdown
    try {
      await sendRequest(proc, 999, 'shutdown');
    } catch {
      // Ignore shutdown errors
    }
    proc.stdin!.end();
    await new Promise<void>((resolve) => proc.on('close', () => resolve()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('initialize handshake returns correct name/kind/capabilities', async () => {
    const res = await sendRequest(proc, 1, 'initialize', {
      protocol: 1,
      home: tmpDir,
    });
    expect(res.ok).toBe(true);
    const result = res.result as Record<string, unknown>;
    expect(result.name).toBe('diffwiki-ripgrep');
    expect(result.kind).toBe('search');
    expect((result.capabilities as Record<string, unknown>).searchTypes).toEqual(['text', 'regex']);
  });

  it('search returns a real hit for the seeded phrase', async () => {
    const res = await sendRequest(proc, 2, 'search', {
      term: 'quick brown fox',
      collections: [{ name: 'mycollection', path: collectionDir }],
      type: 'text',
      limit: 5,
    });
    expect(res.ok).toBe(true);
    const result = res.result as { hits: Array<Record<string, unknown>> };
    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits[0];
    expect(hit.collection).toBe('mycollection');
    expect(hit.relPath).toBe('notes.md');
    expect(typeof hit.title).toBe('string');
    expect((hit.snippet as string).toLowerCase()).toContain('quick brown fox');
  });

  it('health reports ready:true with rg present', async () => {
    const res = await sendRequest(proc, 3, 'health', {
      collections: [{ name: 'mycollection', path: collectionDir }],
    });
    expect(res.ok).toBe(true);
    const result = res.result as { ready: boolean; readiness: Record<string, unknown> };
    expect(result.ready).toBe(true);
    expect(result.readiness.toolInstalled).toBe(true);
    expect(result.readiness.firstSearchCost).toBe('instant');
  });

  it('regex search returns a real hit using a regex pattern', async () => {
    const res = await sendRequest(proc, 4, 'search', {
      term: 'qu[ia]ck',
      collections: [{ name: 'mycollection', path: collectionDir }],
      type: 'regex',
      limit: 5,
    });
    expect(res.ok).toBe(true);
    const result = res.result as { hits: Array<Record<string, unknown>> };
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].collection).toBe('mycollection');
  });
});
