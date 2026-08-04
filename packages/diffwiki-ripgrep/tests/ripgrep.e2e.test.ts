// Gated real e2e: skipped when `rg` is not on PATH (`describe.skipIf(!rgPresent)`).
// When rg IS present, spawns the built dist/bin.js as a one-shot subprocess per op
// and drives the full describe->search round-trip over stdio to prove the real rg
// integration using the definePlugin SDK protocol.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rgOnPath, spawnRg } from '../src/ripgrep.js';

// Probe rg at module load -- determines whether the suite runs or skips.
const rgPresent = await rgOnPath(spawnRg);

const BIN_PATH = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

interface PluginResponse {
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

/**
 * Spawn the plugin binary as a one-shot subprocess: write one JSON request to
 * stdin, close stdin, read the JSON response from stdout, and wait for exit.
 */
async function invokePlugin(op: string, params: Record<string, unknown> = {}): Promise<PluginResponse> {
  return new Promise<PluginResponse>((resolve, reject) => {
    const proc = spawn('node', [BIN_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      // Parse the last non-empty line of stdout as the response
      const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        reject(new Error(`Plugin exited with code ${code}, no output. stderr: ${stderr}`));
        return;
      }
      try {
        const response = JSON.parse(lines[lines.length - 1]) as PluginResponse;
        resolve(response);
      } catch {
        reject(new Error(`Failed to parse plugin response: ${lines[lines.length - 1]}`));
      }
    });

    // Write the one-shot request and close stdin
    const req = JSON.stringify({ op, params });
    proc.stdin!.write(req + '\n', () => {
      proc.stdin!.end();
    });
  });
}

describe.skipIf(!rgPresent)('ripgrep e2e -- real rg subprocess (one-shot)', () => {
  let tmpDir: string;
  let collectionDir: string;

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
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('describe returns correct name/kind/capabilities', async () => {
    const res = await invokePlugin('describe', {});
    expect(res.ok).toBe(true);
    const result = res.result as Record<string, unknown>;
    expect(result.name).toBe('diffwiki-ripgrep');
    expect(result.kind).toBe('search');
    expect((result.capabilities as Record<string, unknown>).searchTypes).toEqual(['fuzzy']);
  });

  it('search returns a real hit for the seeded phrase', async () => {
    const res = await invokePlugin('search', {
      term: 'quick brown fox',
      collections: [{ name: 'mycollection', path: collectionDir }],
      type: 'fuzzy',
      limit: 5,
    });
    expect(res.ok).toBe(true);
    const result = res.result as { hits: Array<Record<string, unknown>> };
    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits[0];
    expect(hit.collection).toBe('mycollection');
    expect(hit.relPath).toBe('notes.md');
    expect(typeof hit.title).toBe('string');
    // The snippet is the matched line. Which line ranks first depends on fzf
    // (which may be absent in CI → plain ripgrep order), so only assert a
    // non-empty snippet here rather than a specific line.
    expect(typeof hit.snippet).toBe('string');
    expect((hit.snippet as string).length).toBeGreaterThan(0);
  });

  it('health reports ready:true with rg present', async () => {
    const res = await invokePlugin('health', {
      collections: [{ name: 'mycollection', path: collectionDir }],
    });
    expect(res.ok).toBe(true);
    const result = res.result as { ready: boolean; readiness: Record<string, unknown> };
    expect(result.ready).toBe(true);
    expect(result.readiness.toolInstalled).toBe(true);
    expect(result.readiness.firstSearchCost).toBe('instant');
  });

  it('matches multi-word queries regardless of word order (token recall)', async () => {
    // The old fixed-strings "text" mode could not match "fox quick" against
    // "quick brown fox"; the fuzzy mode tokenizes, so word order is irrelevant.
    const res = await invokePlugin('search', {
      term: 'fox quick',
      collections: [{ name: 'mycollection', path: collectionDir }],
      type: 'fuzzy',
      limit: 5,
    });
    expect(res.ok).toBe(true);
    const result = res.result as { hits: Array<Record<string, unknown>> };
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].collection).toBe('mycollection');
    expect(result.hits[0].relPath).toBe('notes.md');
  });
});
