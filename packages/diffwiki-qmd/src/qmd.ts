import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** The qmd index name all invocations share. */
export const INDEX = 'diffwiki';

export type Env = NodeJS.ProcessEnv;

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Shape of `promisify(execFile)` — injectable so tests never spawn real qmd. */
export type ExecFileFn = (file: string, args: readonly string[], options: { env?: Env }) => Promise<ExecResult>;

const nodeExecFileAsync = promisify(execFile);

export const execFileAsync: ExecFileFn = (file, args, options) =>
  nodeExecFileAsync(file, args as string[], options) as Promise<ExecResult>;

/**
 * Env for qmd invocations: relocate qmd's cache/config under `<home>/qmd` so its
 * index, config, and downloaded models live inside diffwiki's home (~/.diffwiki/qmd).
 */
export function qmdEnv(home: string): Env {
  const base = join(home, 'qmd');
  return { ...process.env, XDG_CACHE_HOME: base, XDG_CONFIG_HOME: base };
}

/** Directory qmd caches its downloaded GGUF models in, under the relocated cache. */
export function modelsDir(home: string): string {
  return join(home, 'qmd', 'qmd', 'models');
}

/** True if `qmd` answers `--version` on PATH. Never throws. */
export async function qmdOnPath(exec: ExecFileFn, env: Env): Promise<boolean> {
  try {
    await exec('qmd', ['--version'], { env });
    return true;
  } catch {
    return false;
  }
}

/** Run `qmd <args>` and return trimmed stdout as text. */
export async function runQmd(exec: ExecFileFn, args: readonly string[], env: Env): Promise<string> {
  const { stdout } = await exec('qmd', args, { env });
  return stdout.trim();
}

/** Run `qmd <args>` and JSON-parse stdout. */
export async function runQmdJson<T>(exec: ExecFileFn, args: readonly string[], env: Env): Promise<T> {
  const { stdout } = await exec('qmd', args, { env });
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`qmd ${args.join(' ')} did not return valid JSON: ${stdout.slice(0, 200)}`);
  }
}
