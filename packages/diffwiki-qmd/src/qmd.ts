/**
 * qmd CLI helpers — thin wrappers around the SDK's `runProcess` utilities,
 * pre-configured for qmd's relocated XDG environment under `~/.diffwiki/qmd`.
 *
 * @module
 */

import { join } from 'node:path';
import { runProcess, runProcessJson, resolveDependency } from 'diffwiki-core/plugin';
import type { RunProcessOptions, PluginDependency } from 'diffwiki-core/plugin';

/** The qmd index name all invocations share. */
export const INDEX = 'diffwiki';

/** qmd CLI dependency. Resolved from plugin node_modules (no global install needed); PATH qmd is a fallback. */
export const QMD_DEPENDENCY: PluginDependency = {
  command: 'qmd',
  npm: '@tobilu/qmd',
  hint: 'reinstall the plugin (diffwiki plugin install diffwiki-qmd) or: npm i -g @tobilu/qmd',
};

/** Cached resolution of the qmd binary for this process (one-shot plugin runs). */
let cachedQmd: string[] | null | undefined;

/** Resolve the qmd binary to an argv prefix (npm-local bin, then PATH). Cached per process. */
export async function resolveQmd(): Promise<string[] | null> {
  if (cachedQmd === undefined) {
    cachedQmd = (await resolveDependency(QMD_DEPENDENCY, import.meta.url)).command;
  }
  return cachedQmd;
}

/** Clear the cached qmd resolution. For tests that vary qmd availability. */
export function resetQmdResolution(): void {
  cachedQmd = undefined;
}

/** Resolve qmd and build the full argv (`[file, [prefix..., ...args]]`), or throw if unresolved. */
async function qmdArgv(args: readonly string[]): Promise<[string, string[]]> {
  const cmd = await resolveQmd();
  if (!cmd) {
    throw new Error(`qmd not found — ${QMD_DEPENDENCY.hint}`);
  }
  return [cmd[0], [...cmd.slice(1), ...args]];
}

/** Env for qmd invocations: relocates qmd's XDG cache/config under `<home>/qmd`. */
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

/** True if the qmd binary resolves (npm-local or PATH). Never throws. */
export async function qmdOnPath(): Promise<boolean> {
  return (await resolveQmd()) != null;
}

/** Run `qmd <args>` and return trimmed stdout as text. */
export async function runQmd(args: readonly string[], opts?: RunProcessOptions): Promise<string> {
  const [file, full] = await qmdArgv(args);
  const { stdout } = await runProcess(file, full, opts);
  return stdout.trim();
}

/** Run `qmd <args>` and JSON-parse stdout. */
export async function runQmdJson<T>(args: readonly string[], opts?: RunProcessOptions): Promise<T> {
  const [file, full] = await qmdArgv(args);
  return runProcessJson<T>(file, full, opts);
}
