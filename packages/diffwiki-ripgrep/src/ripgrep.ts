/**
 * ripgrep CLI helpers.
 *
 * Low-level functions for spawning `rg`, parsing its `--json` output, and
 * extracting cheap titles from markdown files. These are ripgrep-specific
 * and not shared with other adapters. The generic `commandExists` utility
 * comes from `diffwiki-core/plugin`.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline';
import { commandExists } from 'diffwiki-core/plugin';

/** Injectable spawn function -- resolves raw stdout from `rg <args>`. Exit 1 -> empty string. Throws on exit 2+. */
export type SpawnRgFn = (args: string[]) => Promise<string>;

/** Injectable file-lines reader -- returns up to 20 lines for `cheapTitle`. */
export type ReadFileFn = (absPath: string) => Promise<string[]>;

export interface RunRgOptions {
  /** Use fixed-strings mode (`--fixed-strings -i`). When false, regex mode (default). */
  fixedStrings: boolean;
  /** Max matches returned per rg invocation. Default 20. */
  limit: number;
}

/**
 * Real rg spawner: collects stdout, treats exit 1 (no matches) as empty output,
 * throws for exit 2+ (real rg error).
 */
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

/**
 * Real file-lines reader: reads up to 20 lines from `absPath` using readline,
 * resolves early once 20 lines are read.
 */
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

/**
 * True if `rg` is on PATH. Uses the SDK's `commandExists` utility.
 * Accepts optional injected spawner for backward compatibility with tests.
 */
export async function rgOnPath(spawnFn: SpawnRgFn = spawnRg): Promise<boolean> {
  if (spawnFn !== spawnRg) {
    // Test-injected spawner -- use the old probe logic
    try {
      await spawnFn(['--version']);
      return true;
    } catch {
      return false;
    }
  }
  return commandExists('rg');
}

/**
 * Run `rg --json` with the given pattern and collection root paths.
 */
export async function runRg(spawnFn: SpawnRgFn, pattern: string, roots: string[], opts: RunRgOptions): Promise<string> {
  const limit = opts.limit > 0 ? opts.limit : 20;
  const args: string[] = ['--json', '--line-number', '--max-count', String(limit), '--glob', '*.{md,mdx}'];
  if (opts.fixedStrings) {
    args.push('--fixed-strings', '-i');
  }
  args.push('--', pattern, ...roots);
  return spawnFn(args);
}

/**
 * Cheap title extraction: reads up to 20 lines and returns the first YAML
 * frontmatter `title:` value, or the first ATX heading text, or the file
 * basename without extension.
 */
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
