/**
 * qmd CLI helpers.
 *
 * Thin wrappers around the `runProcess` / `runProcessJson` SDK utilities,
 * pre-configured for qmd's environment (relocated XDG dirs under
 * `~/.diffwiki/qmd`). Also exports the shared index name and path helpers
 * that both the adapter and its tests use.
 *
 * @module
 */

import { join } from 'node:path';
import { runProcess, runProcessJson, commandExists } from 'diffwiki-core/plugin';
import type { RunProcessOptions } from 'diffwiki-core/plugin';

/** The qmd index name all invocations share. */
export const INDEX = 'diffwiki';

/**
 * Env for qmd invocations: relocate qmd's cache/config under `<home>/qmd` so its
 * index, config, and downloaded models live inside diffwiki's home (~/.diffwiki/qmd).
 */
export function qmdEnv(home: string): NodeJS.ProcessEnv {
  const base = join(home, 'qmd');
  return { ...process.env, XDG_CACHE_HOME: base, XDG_CONFIG_HOME: base };
}

/** Directory qmd caches its downloaded GGUF models in, under the relocated cache. */
export function modelsDir(home: string): string {
  return join(home, 'qmd', 'qmd', 'models');
}

/** Path to the qmd index sqlite3 file under the relocated cache. */
export function qmdIndexPath(home: string): string {
  return join(home, 'qmd', 'qmd', `${INDEX}.sqlite`);
}

/** True if `qmd` answers `--version` on PATH. Never throws. */
export async function qmdOnPath(): Promise<boolean> {
  return commandExists('qmd');
}

/** Run `qmd <args>` and return trimmed stdout as text. */
export async function runQmd(args: readonly string[], opts?: RunProcessOptions): Promise<string> {
  const { stdout } = await runProcess('qmd', args, opts);
  return stdout.trim();
}

/** Run `qmd <args>` and JSON-parse stdout. */
export async function runQmdJson<T>(args: readonly string[], opts?: RunProcessOptions): Promise<T> {
  return runProcessJson<T>('qmd', args, opts);
}
