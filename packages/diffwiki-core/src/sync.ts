import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearConfigValue, readConfig, writeConfig } from './config';
import { DiffwikiError, SyncConflictError, SyncNotLinkedError, SyncRemoteExistsError } from './errors';
import { defaultCommandRunner, resolveForge } from './forge';
import type { CommandOutput, CommandRunner, ForgeAdapter, ForgeKind } from './forge';
import { parseArticle } from './frontmatter';
import { ensureCollectionMeta } from './meta';
import { collectionsDir, resolveHome } from './paths';
import { readRegistry, writeRegistry } from './registry';
import type { CollectionEntry, Registry } from './types';

// types -----------------------------------------------------------------------

export type RebasePreference = 'remote' | 'local' | 'manual';

export interface LinkOptions {
  repo: string;
  user?: string;
  force?: boolean;
  forge?: ForgeAdapter;
  runner?: CommandRunner;
}

export interface LinkResult {
  home: string;
  remoteUrl: string;
  forge: ForgeKind;
  branch: string;
  movedLocalWork: boolean;
  reconciledCollections: string[];
}

export interface PullOptions {
  prefer?: RebasePreference;
  autostash?: boolean;
  continueRebase?: boolean;
  abortRebase?: boolean;
  runner?: CommandRunner;
}

export interface PullResult {
  branch: string;
  baseRef: string;
  rebased: boolean;
  conflicts: string[];
  reconciledCollections: string[];
}

export interface PushOptions {
  includeDrafts?: boolean;
  merge?: boolean;
  prefer?: RebasePreference;
  message?: string;
  title?: string;
  body?: string;
  forge?: ForgeAdapter;
  runner?: CommandRunner;
}

export interface PushResult {
  branch: string;
  forge: ForgeKind;
  committed: boolean;
  pushed: boolean;
  excludedDrafts: string[];
  prCreated: boolean;
  prUrl?: string;
  prNumber?: number;
  merged: boolean;
  conflicts: string[];
}

// api -------------------------------------------------------------------------

export const SYNC_GITIGNORE_ENTRIES = [
  '/qmd/',
  '/stripped/',
  '/plugins/',
  '/logs/',
  '/ui.json',
  '/dist/',
  '/dist-site/',
  '/build/',
  '/.output/',
  '/.tanstack/',
  '/.vite/',
] as const;

export async function reconcileGlobalRegistry(home = resolveHome(), priorRegistry?: Registry): Promise<string[]> {
  const current = await readRegistry();
  const baseCollections = mergeNonGlobalEntries(current.collections, priorRegistry?.collections ?? []);
  const priorGlobalMeta = new Map<string, CollectionEntry>();
  for (const source of [priorRegistry?.collections ?? [], current.collections]) {
    for (const entry of source) {
      if (entry.type === 'global') priorGlobalMeta.set(entry.name, entry);
    }
  }

  const root = path.join(home, 'collections');
  const diskNames = await listSubdirectories(root);
  const diskSet = new Set(diskNames);

  const config = await readConfig();
  for (const entry of current.collections) {
    if (entry.type === 'global' && !diskSet.has(entry.name) && config.defaultCollection === entry.name) {
      await clearConfigValue('defaultCollection');
    }
  }

  const globals: CollectionEntry[] = diskNames.map((name) => {
    const existing = priorGlobalMeta.get(name);
    return {
      name,
      type: 'global',
      path: path.join(root, name),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...(existing?.audience
        ? { audience: existing.audience }
        : name === 'transcripts'
          ? { audience: 'system' as const }
          : {}),
    };
  });

  const next: Registry = {
    version: current.version ?? 1,
    collections: [...globals, ...baseCollections],
  };
  await writeRegistry(next);

  for (const entry of globals) {
    await ensureCollectionMeta(entry);
  }
  return globals.map((g) => g.name);
}

export async function linkHome(opts: LinkOptions): Promise<LinkResult> {
  const runner = opts.runner ?? defaultCommandRunner;
  const forge = opts.forge ?? resolveForge(opts.repo, runner);
  const remoteUrl = forge.remoteUrl;
  const home = resolveHome();
  await fs.mkdir(home, { recursive: true });

  const priorRegistry = await readRegistry();
  const hasGitDir = await pathExists(path.join(home, '.git'));
  if (hasGitDir) {
    const existingOrigin = await getOriginUrl(home, runner);
    if (existingOrigin && normalizeRemoteUrl(existingOrigin) !== normalizeRemoteUrl(remoteUrl) && !opts.force) {
      throw new SyncRemoteExistsError(existingOrigin, remoteUrl);
    }
  } else {
    await initGitRepo(home, runner);
  }

  const existingOrigin = await getOriginUrl(home, runner);
  if (existingOrigin) {
    await runGitChecked(home, ['remote', 'set-url', 'origin', remoteUrl], runner);
  } else {
    await runGitChecked(home, ['remote', 'add', 'origin', remoteUrl], runner);
  }

  const config = await readConfig();
  const username = await resolveSyncUsername(home, opts.user, config.syncUser, forge, runner);
  const branch = `user/${username}`;
  await ensureGitIdentity(home, username, runner);
  await writeSyncGitignoreFile(home);

  await runGitChecked(home, ['fetch', '--prune', 'origin'], runner);
  if (!(await refExists(home, 'refs/remotes/origin/main', runner))) {
    await seedEmptyRemoteMain(home, runner);
  }

  const originMainSha = await revParse(home, 'refs/remotes/origin/main', runner);
  const headExists = await refExists(home, 'HEAD', runner);
  const headIsDescendant =
    headExists &&
    (await runGit(home, ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'], runner)).exitCode === 0;

  let movedLocalWork = false;
  if (headIsDescendant) {
    await untrackIgnoredPaths(home, runner);
    const headSha = await revParse(home, 'HEAD', runner);
    const dirty = (await runGit(home, ['status', '--porcelain'], runner)).stdout.trim().length > 0;
    movedLocalWork = headSha !== originMainSha || dirty;
    await runGitChecked(home, ['checkout', '-B', branch], runner);
    await runGitChecked(home, ['update-ref', 'refs/heads/main', originMainSha], runner);
  } else {
    const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-link-snapshot-'));
    try {
      const copied = await copyNonIgnoredFiles(home, snapshotDir);
      movedLocalWork = copied > 0;
      await clearNonIgnoredFiles(home);
      await runGitChecked(home, ['read-tree', '--empty'], runner);
      await runGitChecked(home, ['update-ref', 'refs/heads/main', originMainSha], runner);
      await runGitChecked(home, ['update-ref', `refs/heads/${branch}`, originMainSha], runner);
      await runGitChecked(home, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], runner);
      await runGitChecked(home, ['reset', '--hard', originMainSha], runner);
      if (copied > 0) {
        await copyDirectoryContents(snapshotDir, home);
      }
      await ensureSyncGitignore(home, runner);
    } finally {
      await fs.rm(snapshotDir, { recursive: true, force: true });
    }
  }

  const latestConfig = await readConfig();
  await writeConfig({
    ...latestConfig,
    syncRepo: remoteUrl,
    syncUser: username,
  });

  const reconciledCollections = await reconcileGlobalRegistry(home, priorRegistry);
  return {
    home,
    remoteUrl,
    forge: forge.kind,
    branch,
    movedLocalWork,
    reconciledCollections,
  };
}

export async function pullHome(opts?: PullOptions): Promise<PullResult> {
  const runner = opts?.runner ?? defaultCommandRunner;
  const home = resolveHome();
  await assertLinkedHome(home, runner);

  const prefer = opts?.prefer ?? 'remote';
  const branch = await resolveActiveUserBranch(home, runner);

  if (opts?.abortRebase) {
    if (await isRebaseInProgress(home)) {
      await runGitChecked(home, ['rebase', '--abort'], runner);
    }
    await popAutostash(home, runner, 'local');
    const reconciledCollections = await reconcileGlobalRegistry(home);
    return { branch, baseRef: 'origin/main', rebased: false, conflicts: [], reconciledCollections };
  }

  if (opts?.continueRebase) {
    if (await isRebaseInProgress(home)) {
      const cont = await runGit(home, ['-c', 'core.editor=true', 'rebase', '--continue'], runner, {
        GIT_EDITOR: 'true',
      });
      if (cont.exitCode !== 0 || (await isRebaseInProgress(home))) {
        const conflicts = await listUnmergedFiles(home, runner);
        throw new SyncConflictError(conflicts);
      }
    }
    await popAutostash(home, runner, prefer);
    await ensureSyncGitignore(home, runner);
    await syncLocalMainRef(home, runner);
    const reconciledCollections = await reconcileGlobalRegistry(home);
    return { branch, baseRef: 'origin/main', rebased: true, conflicts: [], reconciledCollections };
  }

  if (await isRebaseInProgress(home)) {
    const conflicts = await listUnmergedFiles(home, runner);
    throw new SyncConflictError(conflicts);
  }

  await ensureOnBranch(home, branch, runner);
  await ensureSyncGitignore(home, runner);

  const autostash = opts?.autostash ?? true;
  if (autostash) {
    await pushAutostashIfNeeded(home, runner);
  }

  await runGitChecked(home, ['fetch', '--prune', 'origin'], runner);
  if (!(await refExists(home, 'refs/remotes/origin/main', runner))) {
    await popAutostash(home, runner, prefer);
    const reconciledCollections = await reconcileGlobalRegistry(home);
    return { branch, baseRef: 'origin/main', rebased: false, conflicts: [], reconciledCollections };
  }
  await syncLocalMainRef(home, runner);

  const rebaseRes = await runRebase(home, 'refs/remotes/origin/main', prefer, runner);
  if (rebaseRes.exitCode !== 0) {
    const conflicts = await listUnmergedFiles(home, runner);
    throw new SyncConflictError(conflicts);
  }

  await popAutostash(home, runner, prefer);
  await ensureSyncGitignore(home, runner);
  const reconciledCollections = await reconcileGlobalRegistry(home);
  return { branch, baseRef: 'origin/main', rebased: true, conflicts: [], reconciledCollections };
}

export async function pushHome(opts?: PushOptions): Promise<PushResult> {
  const runner = opts?.runner ?? defaultCommandRunner;
  const home = resolveHome();
  const originUrl = await assertLinkedHome(home, runner);
  const forge = opts?.forge ?? resolveForge(originUrl, runner);
  await forge.ensureAvailable();

  const prefer = opts?.prefer ?? 'remote';
  const includeDrafts = opts?.includeDrafts ?? false;
  const branch = await resolveActiveUserBranch(home, runner);
  const username = branch.replace(/^user\//, '');

  if (await isRebaseInProgress(home)) {
    const conflicts = await listUnmergedFiles(home, runner);
    throw new SyncConflictError(conflicts);
  }

  await ensureOnBranch(home, branch, runner);
  await ensureGitIdentity(home, username, runner);
  await ensureSyncGitignore(home, runner);
  await runGitChecked(home, ['fetch', '--prune', 'origin'], runner);
  if (!(await refExists(home, 'refs/remotes/origin/main', runner))) {
    await seedEmptyRemoteMain(home, runner);
  }
  await syncLocalMainRef(home, runner);

  const diskDrafts = await findDraftArticlePaths(home);
  await runGitChecked(home, ['add', '-A'], runner);

  let excludedDrafts: string[] = [];
  if (!includeDrafts) {
    const committedDrafts = await findCommittedDraftPathsSinceMain(home, runner);
    const allDrafts = Array.from(new Set([...diskDrafts, ...committedDrafts])).sort();
    excludedDrafts = diskDrafts;
    for (const relPath of allDrafts) {
      const inMain =
        (await runGit(home, ['cat-file', '-e', `refs/remotes/origin/main:${relPath}`], runner)).exitCode === 0;
      if (inMain) {
        await runGitChecked(home, ['reset', '-q', 'refs/remotes/origin/main', '--', relPath], runner);
      } else {
        await runGit(home, ['rm', '--cached', '-f', '--ignore-unmatch', '--', relPath], runner);
      }
    }
  }

  const hasStaged = (await runGit(home, ['diff', '--cached', '--quiet'], runner)).exitCode !== 0;
  let committed = false;
  if (hasStaged) {
    const commitMsg = opts?.message ?? 'chore(wiki): sync global wiki updates';
    await runGitChecked(home, ['commit', '-m', commitMsg], runner);
    committed = true;
  }

  const isAncestor =
    (await runGit(home, ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'], runner)).exitCode === 0;
  if (!isAncestor) {
    await rebaseWithAutostash(home, prefer, runner);
  }

  const aheadCount = await countAheadCommits(home, 'refs/remotes/origin/main', 'HEAD', runner);
  const remoteBranchRef = `refs/remotes/origin/${branch}`;
  const remoteBranchSha = (await refExists(home, remoteBranchRef, runner))
    ? await revParse(home, remoteBranchRef, runner)
    : undefined;
  const headSha = await revParse(home, 'HEAD', runner);

  let pushed = false;
  if (aheadCount > 0 && remoteBranchSha !== headSha) {
    await runGitChecked(home, ['push', '--force-with-lease', 'origin', branch], runner);
    pushed = true;
  }

  let openPr = await forge.findOpenChangeRequest({ headBranch: branch, baseBranch: 'main' });
  let prCreated = false;
  if (openPr) {
    if (opts?.title !== undefined || opts?.body !== undefined) {
      await forge.updateChangeRequest({
        number: openPr.number,
        title: opts.title,
        body: opts.body,
      });
    }
  } else if (aheadCount > 0) {
    if (!pushed) {
      await runGitChecked(home, ['push', '--force-with-lease', 'origin', branch], runner);
      pushed = true;
    }
    openPr = await forge.createChangeRequest({
      headBranch: branch,
      baseBranch: 'main',
      title: opts?.title ?? `sync(${username}): update wiki`,
      body: opts?.body ?? `Automated diffwiki sync from branch \`${branch}\`.`,
    });
    prCreated = true;
  }

  let merged = false;
  if (opts?.merge && openPr) {
    if (!openPr.conflictFree) {
      await runGitChecked(home, ['fetch', '--prune', 'origin'], runner);
      await rebaseWithAutostash(home, prefer, runner);
      await runGitChecked(home, ['push', '--force-with-lease', 'origin', branch], runner);
      pushed = true;
      const refreshed = await forge.findOpenChangeRequest({ headBranch: branch, baseBranch: 'main' });
      if (!refreshed || !refreshed.conflictFree) {
        throw new SyncConflictError([], 'pull request still reports conflicts after rebasing onto origin/main');
      }
      openPr = refreshed;
    }

    await forge.squashMergeChangeRequest({ number: openPr.number });
    await pushAutostashIfNeeded(home, runner);
    await runGitChecked(home, ['fetch', '--prune', 'origin'], runner);
    await syncLocalMainRef(home, runner);
    await runGitChecked(home, ['reset', '--hard', 'refs/remotes/origin/main'], runner);
    await popAutostash(home, runner, prefer);
    await reconcileGlobalRegistry(home);
    merged = true;
  }

  return {
    branch,
    forge: forge.kind,
    committed,
    pushed,
    excludedDrafts,
    prCreated,
    ...(openPr ? { prUrl: openPr.url, prNumber: openPr.number } : {}),
    merged,
    conflicts: [],
  };
}

// helpers ---------------------------------------------------------------------

function stripIgnoreAffixes(entry: string): string {
  return entry.replace(/^\//, '').replace(/\/$/, '');
}

const IGNORED_TOP_NAMES = new Set(SYNC_GITIGNORE_ENTRIES.map(stripIgnoreAffixes));
const CANONICAL_IGNORE_BY_NAME = new Map(SYNC_GITIGNORE_ENTRIES.map((e) => [stripIgnoreAffixes(e), e]));

function autostashMarkerPath(home: string): string {
  return path.join(home, '.git', 'diffwiki-autostash');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function normalizeRemoteUrl(url: string): string {
  const parsed = safeParseComparable(url);
  return parsed;
}

function safeParseComparable(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

function sanitizeBranchUser(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'user';
}

async function runGit(
  cwd: string,
  args: string[],
  runner: CommandRunner,
  env?: NodeJS.ProcessEnv,
): Promise<CommandOutput> {
  return runner('git', args, { cwd, env });
}

async function runGitChecked(
  cwd: string,
  args: string[],
  runner: CommandRunner,
  env?: NodeJS.ProcessEnv,
): Promise<CommandOutput> {
  const out = await runGit(cwd, args, runner, env);
  if (out.exitCode !== 0) {
    throw new DiffwikiError(`git ${args.join(' ')} failed: ${(out.stderr || out.stdout).trim()}`);
  }
  return out;
}

async function initGitRepo(home: string, runner: CommandRunner): Promise<void> {
  const res = await runGit(home, ['init', '-b', 'main'], runner);
  if (res.exitCode !== 0) {
    await runGitChecked(home, ['init'], runner);
    await runGitChecked(home, ['symbolic-ref', 'HEAD', 'refs/heads/main'], runner);
  }
}

async function getOriginUrl(home: string, runner: CommandRunner): Promise<string | undefined> {
  const res = await runGit(home, ['config', '--get', 'remote.origin.url'], runner);
  if (res.exitCode !== 0) return undefined;
  const trimmed = res.stdout.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function assertLinkedHome(home: string, runner: CommandRunner): Promise<string> {
  if (!(await pathExists(path.join(home, '.git')))) {
    throw new SyncNotLinkedError();
  }
  const url = await getOriginUrl(home, runner);
  if (!url) {
    throw new SyncNotLinkedError();
  }
  return url;
}

async function resolveSyncUsername(
  home: string,
  explicitUser: string | undefined,
  configuredUser: string | undefined,
  forge: ForgeAdapter,
  runner: CommandRunner,
): Promise<string> {
  if (explicitUser && explicitUser.trim().length > 0) return sanitizeBranchUser(explicitUser);
  if (configuredUser && configuredUser.trim().length > 0) return sanitizeBranchUser(configuredUser);
  const forgeUser = await forge.resolveDefaultUser();
  if (forgeUser && forgeUser.trim().length > 0) return sanitizeBranchUser(forgeUser);
  const gitName = await runGit(home, ['config', 'user.name'], runner);
  if (gitName.exitCode === 0 && gitName.stdout.trim().length > 0) {
    return sanitizeBranchUser(gitName.stdout.trim());
  }
  try {
    const osName = os.userInfo().username;
    if (osName && osName.trim().length > 0) return sanitizeBranchUser(osName);
  } catch {
    /* ignore os.userInfo errors in restricted containers */
  }
  return 'user';
}

async function resolveActiveUserBranch(home: string, runner: CommandRunner): Promise<string> {
  const cur = await runGit(home, [' symbolic-ref'.trim(), '--short', 'HEAD'], runner);
  const currentName = cur.exitCode === 0 ? cur.stdout.trim() : '';
  if (currentName.startsWith('user/')) return currentName;
  const config = await readConfig();
  if (config.syncUser && config.syncUser.trim().length > 0) {
    return `user/${sanitizeBranchUser(config.syncUser)}`;
  }
  const gitName = await runGit(home, ['config', 'user.name'], runner);
  if (gitName.exitCode === 0 && gitName.stdout.trim().length > 0) {
    return `user/${sanitizeBranchUser(gitName.stdout.trim())}`;
  }
  return 'user/user';
}

async function ensureOnBranch(home: string, branch: string, runner: CommandRunner): Promise<void> {
  const cur = await runGit(home, ['symbolic-ref', '--short', 'HEAD'], runner);
  if (cur.exitCode === 0 && cur.stdout.trim() === branch) return;
  await runGitChecked(home, ['checkout', '-B', branch], runner);
}

async function ensureGitIdentity(home: string, username: string, runner: CommandRunner): Promise<void> {
  const name = await runGit(home, ['config', 'user.name'], runner);
  if (name.exitCode !== 0 || name.stdout.trim().length === 0) {
    await runGitChecked(home, ['config', 'user.name', username], runner);
  }
  const email = await runGit(home, ['config', 'user.email'], runner);
  if (email.exitCode !== 0 || email.stdout.trim().length === 0) {
    await runGitChecked(home, ['config', 'user.email', `${username}@users.noreply.github.com`], runner);
  }
}

async function writeSyncGitignoreFile(home: string): Promise<void> {
  const target = path.join(home, '.gitignore');
  let raw = '';
  try {
    raw = await fs.readFile(target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  const seen = new Set<string>();
  let upgraded = false;
  const rewrittenLines = raw.length
    ? raw.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return line;
        const bare = stripIgnoreAffixes(trimmed);
        const canonical = CANONICAL_IGNORE_BY_NAME.get(bare);
        if (!canonical) return line;
        seen.add(bare);
        if (trimmed !== canonical) {
          upgraded = true;
          return canonical;
        }
        return line;
      })
    : [];

  const missing = SYNC_GITIGNORE_ENTRIES.filter((entry) => !seen.has(stripIgnoreAffixes(entry)));
  if (!upgraded && missing.length === 0 && raw.length > 0) return;

  while (rewrittenLines.length > 0 && rewrittenLines[rewrittenLines.length - 1] === '') {
    rewrittenLines.pop();
  }
  const allLines = [...rewrittenLines, ...missing];
  await fs.writeFile(target, `${allLines.join('\n')}\n`, 'utf8');
}

async function untrackIgnoredPaths(home: string, runner: CommandRunner): Promise<void> {
  const hasHead = await refExists(home, 'HEAD', runner);
  if (!hasHead) return;
  const targets = SYNC_GITIGNORE_ENTRIES.map(stripIgnoreAffixes);
  await runGit(home, ['rm', '-r', '--cached', '--ignore-unmatch', '--', ...targets], runner);
}

async function ensureSyncGitignore(home: string, runner: CommandRunner): Promise<void> {
  await writeSyncGitignoreFile(home);
  await untrackIgnoredPaths(home, runner);
}

async function refExists(home: string, ref: string, runner: CommandRunner): Promise<boolean> {
  const res = await runGit(home, ['rev-parse', '--verify', '--quiet', ref], runner);
  return res.exitCode === 0 && res.stdout.trim().length > 0;
}

async function revParse(home: string, ref: string, runner: CommandRunner): Promise<string> {
  const res = await runGitChecked(home, ['rev-parse', '--verify', ref], runner);
  return res.stdout.trim();
}

async function seedEmptyRemoteMain(home: string, runner: CommandRunner): Promise<void> {
  await writeSyncGitignoreFile(home);
  const blobOut = await runGitChecked(home, ['hash-object', '-w', '.gitignore'], runner);
  const blobSha = blobOut.stdout.trim();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-seed-idx-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    await runGitChecked(home, ['update-index', '--add', '--cacheinfo', `100644,${blobSha},.gitignore`], runner, {
      GIT_INDEX_FILE: tempIndex,
    });
    const treeOut = await runGitChecked(home, ['write-tree'], runner, { GIT_INDEX_FILE: tempIndex });
    const treeSha = treeOut.stdout.trim();
    const commitOut = await runGitChecked(
      home,
      ['commit-tree', treeSha, '-m', 'chore: initialize diffwiki home'],
      runner,
    );
    const commitSha = commitOut.stdout.trim();
    await runGitChecked(home, ['push', 'origin', `${commitSha}:refs/heads/main`], runner);
    await runGitChecked(home, ['fetch', '--prune', 'origin'], runner);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function copyNonIgnoredFiles(home: string, destDir: string): Promise<number> {
  const entries = await fs.readdir(home, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.gitignore' || IGNORED_TOP_NAMES.has(entry.name)) continue;
    const src = path.join(home, entry.name);
    const dst = path.join(destDir, entry.name);
    await fs.cp(src, dst, { recursive: true });
    count += 1;
  }
  return count;
}

async function clearNonIgnoredFiles(home: string): Promise<void> {
  const entries = await fs.readdir(home, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.gitignore' || IGNORED_TOP_NAMES.has(entry.name)) continue;
    await fs.rm(path.join(home, entry.name), { recursive: true, force: true });
  }
}

async function copyDirectoryContents(srcDir: string, destDir: string): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    await fs.cp(path.join(srcDir, entry.name), path.join(destDir, entry.name), { recursive: true, force: true });
  }
}

function mergeNonGlobalEntries(current: CollectionEntry[], prior: CollectionEntry[]): CollectionEntry[] {
  const byName = new Map<string, CollectionEntry>();
  for (const entry of prior) {
    if (entry.type !== 'global') byName.set(entry.name, entry);
  }
  for (const entry of current) {
    if (entry.type !== 'global') byName.set(entry.name, entry);
  }
  return Array.from(byName.values());
}

async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    return items
      .filter((i) => i.isDirectory() && !i.name.startsWith('.'))
      .map((i) => i.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
}

async function isRebaseInProgress(home: string): Promise<boolean> {
  return (
    (await pathExists(path.join(home, '.git', 'rebase-merge'))) ||
    (await pathExists(path.join(home, '.git', 'rebase-apply')))
  );
}

async function listUnmergedFiles(home: string, runner: CommandRunner): Promise<string[]> {
  const res = await runGit(home, ['diff', '--name-only', '--diff-filter=U'], runner);
  if (res.exitCode !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();
}

async function syncLocalMainRef(home: string, runner: CommandRunner): Promise<void> {
  if (!(await refExists(home, 'refs/remotes/origin/main', runner))) return;
  const cur = await runGit(home, ['symbolic-ref', '--short', 'HEAD'], runner);
  if (cur.exitCode === 0 && cur.stdout.trim() === 'main') return;
  const sha = await revParse(home, 'refs/remotes/origin/main', runner);
  await runGitChecked(home, ['update-ref', 'refs/heads/main', sha], runner);
}

async function runRebase(
  home: string,
  upstream: string,
  prefer: RebasePreference,
  runner: CommandRunner,
): Promise<CommandOutput> {
  if (prefer === 'remote') {
    return runGit(home, ['rebase', '-X', 'ours', upstream], runner);
  }
  if (prefer === 'local') {
    return runGit(home, ['rebase', '-X', 'theirs', upstream], runner);
  }
  return runGit(home, ['rebase', upstream], runner);
}

async function rebaseWithAutostash(home: string, prefer: RebasePreference, runner: CommandRunner): Promise<void> {
  await pushAutostashIfNeeded(home, runner);
  const res = await runRebase(home, 'refs/remotes/origin/main', prefer, runner);
  if (res.exitCode !== 0) {
    const conflicts = await listUnmergedFiles(home, runner);
    throw new SyncConflictError(conflicts);
  }
  await popAutostash(home, runner, prefer);
}

async function pushAutostashIfNeeded(home: string, runner: CommandRunner): Promise<boolean> {
  const status = await runGit(home, ['status', '--porcelain'], runner);
  if (status.stdout.trim().length === 0) return false;
  const beforeSha = (await refExists(home, 'refs/stash', runner)) ? await revParse(home, 'refs/stash', runner) : '';
  await runGitChecked(home, ['stash', 'push', '--include-untracked', '-m', 'diffwiki-sync-autostash'], runner);
  const afterSha = (await refExists(home, 'refs/stash', runner)) ? await revParse(home, 'refs/stash', runner) : '';
  if (afterSha && afterSha !== beforeSha) {
    await fs.writeFile(autostashMarkerPath(home), `${afterSha}\n`, 'utf8');
    return true;
  }
  return false;
}

async function popAutostash(home: string, runner: CommandRunner, prefer: RebasePreference): Promise<void> {
  const marker = autostashMarkerPath(home);
  if (!(await pathExists(marker))) return;
  const recordedSha = (await fs.readFile(marker, 'utf8')).trim();
  await fs.rm(marker, { force: true });
  if (!recordedSha) return;

  const topSha = (await refExists(home, 'refs/stash', runner)) ? await revParse(home, 'refs/stash', runner) : '';
  const targetRef = topSha === recordedSha ? 'stash@{0}' : recordedSha;
  const applyRes = await runGit(home, ['stash', 'apply', targetRef], runner);
  if (applyRes.exitCode !== 0) {
    const unmerged = await listUnmergedFiles(home, runner);
    for (const rel of unmerged) {
      const side = prefer === 'remote' ? '--ours' : '--theirs';
      await runGit(home, ['checkout', side, '--', rel], runner);
      await runGit(home, ['reset', 'HEAD', '--', rel], runner);
    }
  }
  if (topSha === recordedSha) {
    await runGit(home, ['stash', 'drop', 'stash@{0}'], runner);
  }
}

async function findDraftArticlePaths(home: string): Promise<string[]> {
  const root = collectionsDir();
  if (path.resolve(root) !== path.resolve(path.join(home, 'collections'))) {
    return collectDraftsUnder(home, path.join(home, 'collections'));
  }
  return collectDraftsUnder(home, root);
}

async function collectDraftsUnder(home: string, dir: string): Promise<string[]> {
  let items: import('node:fs').Dirent[];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
  const found: string[] = [];
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      found.push(...(await collectDraftsUnder(home, full)));
    } else if (item.isFile() && /\.mdx?$/i.test(item.name)) {
      const raw = await fs.readFile(full, 'utf8');
      if (parseArticle(raw).status === 'draft') {
        found.push(path.relative(home, full).split(path.sep).join('/'));
      }
    }
  }
  return found.sort();
}

async function findCommittedDraftPathsSinceMain(home: string, runner: CommandRunner): Promise<string[]> {
  const diff = await runGit(
    home,
    ['diff', '--name-only', 'refs/remotes/origin/main...HEAD', '--', 'collections'],
    runner,
  );
  if (diff.exitCode !== 0 || !diff.stdout.trim()) return [];
  const candidates = diff.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\.mdx?$/i.test(l));
  const drafts: string[] = [];
  for (const rel of candidates) {
    const show = await runGit(home, ['show', `HEAD:${rel}`], runner);
    if (show.exitCode === 0 && parseArticle(show.stdout).status === 'draft') {
      drafts.push(rel);
    }
  }
  return drafts;
}

async function countAheadCommits(
  home: string,
  baseRef: string,
  headRef: string,
  runner: CommandRunner,
): Promise<number> {
  const out = await runGitChecked(home, ['rev-list', '--count', `${baseRef}..${headRef}`], runner);
  return Number.parseInt(out.stdout.trim(), 10) || 0;
}
