import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from './logger';

const execFileAsync = promisify(execFile);
const log = getLogger('git');

/**
 * Run a git command in `cwd`; trimmed stdout, or undefined on any failure.
 *
 * Failures degrade gracefully (a missing/broken git install just drops branch
 * info from the sidebar rather than erroring), but they are logged at debug level
 * so a broken git install is diagnosable instead of silently swallowed.
 */
async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch (err) {
    log.debug('git {args} failed in {cwd}: {error}', {
      args: args.join(' '),
      cwd,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Absolute working-tree root, or undefined when `cwd` is not inside a git repo. */
export async function gitToplevel(cwd: string): Promise<string | undefined> {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

/**
 * True when `cwd` sits inside a *linked* worktree (not the primary working tree).
 * In the primary tree `--absolute-git-dir` and `--git-common-dir` resolve to the
 * same directory; in a linked worktree the git-dir is `<common>/worktrees/<name>`.
 */
export async function isLinkedWorktree(cwd: string): Promise<boolean> {
  const gitDir = await git(cwd, ['rev-parse', '--absolute-git-dir']);
  const commonDir = await git(cwd, ['rev-parse', '--git-common-dir']);
  if (!gitDir || !commonDir) return false;
  const commonAbs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
  return path.resolve(gitDir) !== path.resolve(commonAbs);
}

/** Short repo name from the `origin` remote URL (basename, `.git` stripped), or undefined. */
export async function repoRemoteName(cwd: string): Promise<string | undefined> {
  const url = await git(cwd, ['remote', 'get-url', 'origin']);
  if (!url) return undefined;
  const base = url.replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  const name = base.replace(/\.git$/, '');
  return name.length > 0 ? name : undefined;
}

/**
 * A stable identifier for the repo, independent of checkout location. Prefers the
 * root (first) commit hash — identical across clones/worktrees; falls back to the
 * normalised origin URL when there is no commit yet. Undefined when neither exists.
 */
export async function repoId(cwd: string): Promise<string | undefined> {
  const roots = await git(cwd, ['rev-list', '--max-parents=0', 'HEAD']);
  if (roots) return `commit:${roots.split('\n')[0]}`;
  const url = await git(cwd, ['remote', 'get-url', 'origin']);
  if (url) return `remote:${url.replace(/\.git$/, '').replace(/\/+$/, '')}`;
  return undefined;
}

/** Current short branch name, or undefined (detached HEAD / not a repo). */
export async function currentBranch(cwd: string): Promise<string | undefined> {
  const name = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return name && name !== 'HEAD' ? name : undefined;
}

export interface UpstreamStatus {
  branch?: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

/**
 * Ahead/behind counts of the current branch versus its upstream. `hasUpstream` is
 * false when no upstream is configured (then ahead/behind are 0).
 */
export async function upstreamStatus(cwd: string): Promise<UpstreamStatus> {
  const branch = await currentBranch(cwd);
  // left-right count of @{upstream}...HEAD → "<behind>\t<ahead>".
  const counts = await git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
  if (!counts) return { branch, ahead: 0, behind: 0, hasUpstream: false };
  const [behind, ahead] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10) || 0);
  return { branch, ahead, behind, hasUpstream: true };
}

/** Ensure `cwd` is inside a git repo, running `git init` if not. Returns the toplevel. */
export async function ensureGitRepo(cwd: string): Promise<string> {
  const top = await gitToplevel(cwd);
  if (top) return top;
  await execFileAsync('git', ['init'], { cwd });
  const after = await gitToplevel(cwd);
  if (!after) throw new Error('git init did not produce a repository');
  return after;
}
