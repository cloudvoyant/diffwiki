import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCollections, resolveCollectionSelection, InvalidExportSelectionError } from 'diffwiki-core';

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
 * Locate the wiki app's export harness in a workspace/monorepo checkout, so
 * `diffwiki export` uses the LOCAL built packages instead of the published app.
 * Checked relative to this CLI (packages/diffwiki-cli/dist) and to the cwd.
 */
function localAppExporter(): string | undefined {
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/wiki/bin/export.mjs'),
    path.resolve(process.cwd(), 'apps/wiki/bin/export.mjs'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/**
 * Drive the static export by invoking the wiki app's `export` harness. Mirrors the
 * `startUi` approach: the CLI does not bundle the app. Resolution order:
 *   1. `DIFFWIKI_APP_CMD` (explicit override), else
 *   2. the local workspace app (`apps/wiki/bin/export.mjs`) when present — this is
 *      what makes `diffwiki export` use local built packages in a checkout, else
 *   3. the published `diffwiki-app@latest` (via npx) for an installed CLI.
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

  const local = localAppExporter();
  const override = process.env.DIFFWIKI_APP_CMD ?? (local ? `node ${local}` : undefined);
  const [cmd, ...prefix] = override ? override.split(' ') : ['npx', '-y', 'diffwiki-app@latest'];
  // `export` is a no-op positional for the local harness (it reads flags by name)
  // and the subcommand the published `diffwiki-app` bin dispatches on.
  const args = [...prefix, 'export', '--out', out, '--base', opts.base];
  if (opts.filter) args.push('--filter', opts.filter);
  if (opts.exclude) args.push('--exclude', opts.exclude);
  if (opts.project) {
    args.push('--project');
    if (typeof opts.project === 'string') args.push(opts.project);
  }

  if (override) console.log(`Exporting via ${override}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`export failed (exit ${code})`))));
  });
  console.log(`Static site written to ${out}`);
}
