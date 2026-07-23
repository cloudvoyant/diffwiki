import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { findCollection, findCollectionById, listCollections } from './collections';
import { registerCollection } from './registry';
import { ensureGitRepo, gitToplevel, isLinkedWorktree, repoId, repoRemoteName, upstreamStatus } from './git';
import { CollectionAlreadyAddedError, WorktreeNotAllowedError } from './errors';
import type { CollectionEntry, RepoConfig } from './types';

const execFileAsync = promisify(execFile);

export const REPO_CONFIG_FILE = 'diffwiki.yaml';

async function detectRepoName(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
    return path.basename(stdout.trim());
  } catch {
    return path.basename(path.resolve(cwd));
  }
}

export async function readRepoConfig(cwd: string): Promise<RepoConfig | undefined> {
  try {
    const raw = await fs.readFile(path.join(cwd, REPO_CONFIG_FILE), 'utf8');
    const parsed = (parseYaml(raw) ?? {}) as Partial<RepoConfig>;
    if (!parsed.path) return undefined;
    return {
      collection: parsed.collection ?? path.basename(path.resolve(cwd)),
      path: parsed.path,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export interface InitOptions {
  cwd: string;
  collection?: string;
  wikiPath?: string;
}

export async function initRepoWiki(opts: InitOptions): Promise<CollectionEntry> {
  const cwd = path.resolve(opts.cwd);
  const wikiPath = opts.wikiPath ?? 'wiki';
  const absWiki = path.join(cwd, wikiPath);

  let name = opts.collection ?? (await detectRepoName(cwd));
  const existing = await findCollection(name);
  if (existing && existing.path !== absWiki) {
    let n = 2;
    for (;;) {
      const candidate = `${name}-${n}`;
      const clash = await findCollection(candidate);
      if (!clash || clash.path === absWiki) {
        name = candidate;
        break;
      }
      n += 1;
    }
  }

  await fs.mkdir(absWiki, { recursive: true });
  const config: RepoConfig = { collection: name, path: wikiPath };
  await fs.writeFile(path.join(cwd, REPO_CONFIG_FILE), stringifyYaml(config), 'utf8');

  const entry: CollectionEntry = {
    name,
    type: 'repo',
    path: absWiki,
    createdAt: new Date().toISOString(),
  };
  await registerCollection(entry);
  return entry;
}

export interface AddExternalOptions {
  cwd: string;
  /** Content dir relative to the repo root. Default "docs". */
  docsDir?: string;
}

/**
 * Register the git repo containing `cwd` as an `external` collection: title from
 * the git remote (fallback repo dir), content dir `docs/` by default, git-only
 * (auto `git init`), unique by repo id, and refusing linked worktrees.
 */
export async function addExternalCollection(opts: AddExternalOptions): Promise<CollectionEntry> {
  const cwd = path.resolve(opts.cwd);
  const root = await ensureGitRepo(cwd);
  if (await isLinkedWorktree(cwd)) throw new WorktreeNotAllowedError(root);

  const id = (await repoId(root)) ?? `path:${root}`;
  const already = await findCollectionById(id);
  if (already) throw new CollectionAlreadyAddedError(already.name);

  const docsRel = opts.docsDir ?? 'docs';
  const contentDir = path.join(root, docsRel);

  let name = (await repoRemoteName(root)) ?? path.basename(root);
  if (await findCollection(name)) {
    let n = 2;
    while (await findCollection(`${name}-${n}`)) n += 1;
    name = `${name}-${n}`;
  }

  const entry: CollectionEntry = {
    name,
    type: 'external',
    path: contentDir,
    createdAt: new Date().toISOString(),
    id,
    repoRoot: root,
    docsDir: docsRel,
  };
  await registerCollection(entry);
  return entry;
}

/**
 * The registered collection the current directory belongs to: an external
 * collection whose repo id matches, else any collection whose content path (or
 * repoRoot) contains `cwd`. Undefined when cwd is outside every known collection.
 */
export async function resolveCwdCollection(cwd: string): Promise<CollectionEntry | undefined> {
  const abs = path.resolve(cwd);
  const root = await gitToplevel(abs);
  if (root) {
    const id = (await repoId(root)) ?? `path:${root}`;
    const byId = await findCollectionById(id);
    if (byId) return byId;
  }
  const within = (base: string) => abs === base || abs.startsWith(base + path.sep);
  // Most-specific-path wins: when collections nest (e.g. a repo collection whose
  // docsDir sits inside another registered path), pick the one whose matching
  // base is the longest, not merely the first in registry order.
  const all = await listCollections();
  let best: CollectionEntry | undefined;
  let bestLen = -1;
  for (const c of all) {
    const bases = [c.path, c.repoRoot].filter((b): b is string => b !== undefined);
    for (const b of bases) {
      if (within(b) && b.length > bestLen) {
        best = c;
        bestLen = b.length;
      }
    }
  }
  return best;
}

export interface CollectionGitStatus {
  branch?: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

/**
 * Branch + upstream status for an external collection, from its repo root.
 * Undefined for non-external collections or when git is unavailable (e.g. during
 * static generation) — callers warn + omit.
 */
export async function collectionGitStatus(entry: CollectionEntry): Promise<CollectionGitStatus | undefined> {
  if (entry.type !== 'external' || !entry.repoRoot) return undefined;
  const top = await gitToplevel(entry.repoRoot);
  if (!top) return undefined;
  const s = await upstreamStatus(entry.repoRoot);
  return { branch: s.branch, ahead: s.ahead, behind: s.behind, hasUpstream: s.hasUpstream };
}
