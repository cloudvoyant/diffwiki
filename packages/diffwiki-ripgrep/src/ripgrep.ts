/**
 * ripgrep + fzf helpers.
 *
 * The plugin's single search mode combines two tools: `rg` (ripgrep) scans the
 * markdown for candidate lines matching any query token (fast, high recall),
 * then `fzf --filter` fuzzy-ranks those candidates against the full query (each
 * space-separated term ANDed, typo-tolerant). When fzf is unavailable the raw
 * ripgrep candidates are returned in file order (degraded, still useful).
 *
 * @module
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import { commandExists } from 'diffwiki-core/plugin';
import type { SpawnRgFn, SpawnFzfFn, ReadFileFn, RunRgOptions, RgLine } from './types.js';

// Re-export so existing imports from ripgrep.js continue to resolve.
export type { SpawnRgFn, SpawnFzfFn, ReadFileFn, RunRgOptions } from './types.js';

/** Real rg spawner: exit 1 (no matches) → empty string; exit 2+ → throws. */
export const spawnRg: SpawnRgFn = (args) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(new Error(`rg exited with code ${code}`));
      }
    });
  });

/** Real fzf spawner: writes `input` to stdin; exit 1 (no match) → empty string; exit 2+ → throws. */
export const spawnFzf: SpawnFzfFn = (args, input) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn('fzf', args, { stdio: ['pipe', 'pipe', 'ignore'] });
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(new Error(`fzf exited with code ${code}`));
      }
    });
    proc.stdin.on('error', () => {
      /* ignore EPIPE if fzf closes stdin early */
    });
    proc.stdin.end(input);
  });

/** Read up to 20 lines from `absPath`; resolves early once 20 lines are collected. */
export const readFileLines: ReadFileFn = (absPath) =>
  new Promise<string[]>((resolve, reject) => {
    const lines: string[] = [];
    const stream = createReadStream(absPath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      lines.push(line);
      if (lines.length >= 20) {
        rl.close();
        stream.destroy();
      }
    });
    rl.on('close', () => resolve(lines));
    rl.on('error', reject);
    stream.on('error', reject);
  });

/** True if a command is on PATH. Accepts an injected spawner for test compatibility. */
async function toolOnPath(name: string, probe: (() => Promise<unknown>) | null): Promise<boolean> {
  if (probe) {
    try {
      await probe();
      return true;
    } catch {
      return false;
    }
  }
  return commandExists(name);
}

/** True if `rg` is on PATH. Accepts an injected spawner for test compatibility. */
export async function rgOnPath(spawnFn: SpawnRgFn = spawnRg): Promise<boolean> {
  return toolOnPath('rg', spawnFn === spawnRg ? null : () => spawnFn(['--version']));
}

/** True if `fzf` is on PATH. Accepts an injected spawner for test compatibility. */
export async function fzfOnPath(fzfFn: SpawnFzfFn = spawnFzf): Promise<boolean> {
  return toolOnPath('fzf', fzfFn === spawnFzf ? null : () => fzfFn(['--version'], ''));
}

/** Split a query into lowercased word tokens (letters/digits/underscore runs). */
export function tokenize(query: string): string[] {
  return query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** Escape a token for use inside a ripgrep regex alternation. */
function escapeRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run ripgrep for candidate lines matching ANY query token (an OR alternation,
 * smart-case), emitting plain `path:line:text` lines over `*.md`/`*.mdx`. High
 * recall by design — fzf does the precise ranking. Returns '' when the query has
 * no usable tokens.
 */
export async function runRg(spawnFn: SpawnRgFn, query: string, roots: string[], opts: RunRgOptions): Promise<string> {
  const tokens = tokenize(query);
  if (tokens.length === 0 || roots.length === 0) return '';
  const pattern = tokens.map(escapeRegex).join('|');
  const limit = opts.limit > 0 ? opts.limit : 20;
  const args: string[] = [
    '--line-number',
    '--no-heading',
    '--with-filename',
    '--color',
    'never',
    '--smart-case',
    '--max-count',
    String(limit),
    '--glob',
    '*.{md,mdx}',
    '-e',
    pattern,
    '--',
    ...roots,
  ];
  return spawnFn(args);
}

/**
 * Fuzzy-rank ripgrep candidate lines with `fzf --filter`. fzf's default
 * extended-search mode ANDs each space-separated term (fuzzily), so the whole
 * query must match; output is ordered best-first. Returns '' on no match.
 */
export async function fuzzyRank(fzfFn: SpawnFzfFn, candidates: string, query: string): Promise<string> {
  if (candidates.trim().length === 0) return '';
  return fzfFn(['--filter', query], candidates);
}

/** Parse a plain ripgrep line `path:line:text` (path may contain no newline). Returns null if unparseable. */
export function parseRgLine(line: string): RgLine | null {
  const m = /^(.*?):(\d+):(.*)$/.exec(line);
  if (!m) return null;
  return { path: m[1], lineNumber: Number(m[2]), text: m[3] };
}

/** Extract a cheap title: first YAML `title:`, first ATX heading, or filename. */
export async function cheapTitle(absPath: string, readFn: ReadFileFn = readFileLines): Promise<string> {
  let lines: string[];
  try {
    lines = await readFn(absPath);
  } catch {
    return basename(absPath, extname(absPath));
  }

  // YAML frontmatter: first line must be '---'
  if (lines.length > 0 && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---' || line.trim() === '...') break;
      const m = line.match(/^title:\s*(.+)/i);
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  // First ATX heading
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+)/);
    if (m) return m[1].trim();
  }

  return basename(absPath, extname(absPath));
}
