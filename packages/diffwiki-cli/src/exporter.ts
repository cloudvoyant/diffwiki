import { spawn } from 'node:child_process';
import path from 'node:path';
import { listCollections, resolveCollectionSelection, InvalidExportSelectionError } from 'diffwiki-core';
import { resolveAppLaunch } from './app';

export interface ExportOptions {
  out: string;
  base: string;
  /** Comma-separated include globs (only these collections). */
  filter?: string;
  /** Comma-separated exclude globs. */
  exclude?: string;
  /** Build only the repo project's diffwiki.yaml (string dir, or true for cwd). */
  project?: string | boolean;
}

const splitGlobs = (v?: string): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Drive the static export by invoking the wiki app's `export` harness. Mirrors the
 * `startUi` approach: the CLI does not bundle the app. Resolution order:
 *   1. `DIFFWIKI_APP_CMD` (explicit override), else
 *   2. `DIFFWIKI_APP_SPEC` (explicit npx spec — forces the npx path), else
 *   3. the local workspace app (`apps/wiki/bin/export.mjs`) when present — this is
 *      what makes `diffwiki export` use local built packages in a checkout, else
 *   4. the published `diffwiki-app@<cli-version>` (via npx, pinned — never `@latest`)
 *      for an installed CLI.
 *
 * `--filter`/`--exclude` collection selection is validated UPFRONT (before the app
 * is spawned or anything is generated): an unmatched glob or an empty result aborts.
 */
export async function runExport(opts: ExportOptions): Promise<void> {
  const out = path.resolve(opts.out);
  const filter = splitGlobs(opts.filter);
  const exclude = splitGlobs(opts.exclude);

  // Fail fast on a bad selection — but only when NOT in project mode (project mode
  // scopes to diffwiki.yaml via a tmp home the harness seeds; the global registry
  // is not the source of truth then).
  if (!opts.project && (filter.length > 0 || exclude.length > 0)) {
    const names = (await listCollections()).map((c) => c.name);
    const { errors } = resolveCollectionSelection(names, { filter, exclude });
    if (errors.length > 0) throw new InvalidExportSelectionError(errors);
  }

  const { cmd, args, source, spec } = resolveAppLaunch({ localBin: 'export.mjs' });
  // `export` is a no-op positional for the local harness (it reads flags by name)
  // and the subcommand the published `diffwiki-app` bin dispatches on.
  const appArgs = [...args, 'export', '--out', out, '--base', opts.base];
  if (opts.filter) appArgs.push('--filter', opts.filter);
  if (opts.exclude) appArgs.push('--exclude', opts.exclude);
  if (opts.project) {
    appArgs.push('--project');
    if (typeof opts.project === 'string') appArgs.push(opts.project);
  }

  if (source === 'override') console.log(`Exporting via ${spec}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, appArgs, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`export failed (exit ${code})`))));
  });
  console.log(`Static site written to ${out}`);
}
