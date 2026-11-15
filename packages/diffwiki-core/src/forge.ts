import { execFile } from 'node:child_process';
import { DiffwikiError, ForgeUnavailableError, UnsupportedForgeError } from './errors';

// types -----------------------------------------------------------------------

export type ForgeKind = 'github' | 'gitlab';

export interface CommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandOutput>;

export interface ForgeChangeRequest {
  number: number;
  url: string;
  conflictFree: boolean;
}

export interface ForgeAdapter {
  readonly kind: ForgeKind;
  readonly repoSlug: string;
  readonly remoteUrl: string;
  ensureAvailable(): Promise<void>;
  resolveDefaultUser(): Promise<string | undefined>;
  findOpenChangeRequest(opts: { headBranch: string; baseBranch: string }): Promise<ForgeChangeRequest | null>;
  createChangeRequest(opts: {
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<ForgeChangeRequest>;
  updateChangeRequest(opts: { number: number; title?: string; body?: string }): Promise<void>;
  squashMergeChangeRequest(opts: { number: number }): Promise<void>;
}

export interface ParsedGitHubRemote {
  host: string;
  owner: string;
  repo: string;
  repoSlug: string;
  remoteUrl: string;
}

// api -------------------------------------------------------------------------

export const defaultCommandRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts?.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts?.env },
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ exitCode: 0, stdout: String(stdout), stderr: String(stderr) });
          return;
        }
        const errno = err as NodeJS.ErrnoException & { code?: number | string };
        const exitCode = typeof errno.code === 'number' ? errno.code : errno.code === 'ENOENT' ? 127 : 1;
        resolve({
          exitCode,
          stdout: String(stdout ?? ''),
          stderr: String(stderr || err.message),
        });
      },
    );
  });

export class GitHubForge implements ForgeAdapter {
  readonly kind = 'github' as const;
  readonly repoSlug: string;
  readonly remoteUrl: string;
  private readonly host: string;
  private readonly runner: CommandRunner;

  constructor(parsed: ParsedGitHubRemote, runner: CommandRunner = defaultCommandRunner) {
    this.host = parsed.host;
    this.repoSlug = parsed.repoSlug;
    this.remoteUrl = parsed.remoteUrl;
    this.runner = runner;
  }

  async ensureAvailable(): Promise<void> {
    const ver = await this.runner('gh', ['--version']);
    if (ver.exitCode !== 0) {
      throw new ForgeUnavailableError('GitHub (gh)', (ver.stderr || ver.stdout).trim() || 'gh binary not found');
    }
    const authArgs = ['auth', 'status', ...(this.host !== 'github.com' ? ['--hostname', this.host] : [])];
    const auth = await this.runner('gh', authArgs);
    if (auth.exitCode !== 0) {
      throw new ForgeUnavailableError(
        'GitHub (gh)',
        (auth.stderr || auth.stdout).trim() || 'run `gh auth login` first',
      );
    }
  }

  async resolveDefaultUser(): Promise<string | undefined> {
    const args = ['api', 'user', '--jq', '.login', ...(this.host !== 'github.com' ? ['--hostname', this.host] : [])];
    const res = await this.runner('gh', args);
    if (res.exitCode !== 0) return undefined;
    const login = res.stdout.trim();
    return login.length > 0 ? login : undefined;
  }

  async findOpenChangeRequest(opts: { headBranch: string; baseBranch: string }): Promise<ForgeChangeRequest | null> {
    const res = await this.runner('gh', [
      'pr',
      'list',
      '-R',
      this.repoSlug,
      '--head',
      opts.headBranch,
      '--base',
      opts.baseBranch,
      '--state',
      'open',
      '--json',
      'number,url,mergeable,mergeStateStatus',
      '--limit',
      '1',
    ]);
    if (res.exitCode !== 0) {
      throw new DiffwikiError(`gh pr list failed: ${(res.stderr || res.stdout).trim()}`);
    }
    const items = JSON.parse(res.stdout.trim() || '[]') as Array<{
      number: number;
      url: string;
      mergeable?: string;
      mergeStateStatus?: string;
    }>;
    if (items.length === 0) return null;
    const pr = items[0];
    const conflictFree = pr.mergeable !== 'CONFLICTING' && pr.mergeStateStatus !== 'DIRTY';
    return { number: pr.number, url: pr.url, conflictFree };
  }

  async createChangeRequest(opts: {
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<ForgeChangeRequest> {
    const res = await this.runner('gh', [
      'pr',
      'create',
      '-R',
      this.repoSlug,
      '--head',
      opts.headBranch,
      '--base',
      opts.baseBranch,
      '--title',
      opts.title,
      '--body',
      opts.body,
    ]);
    if (res.exitCode !== 0) {
      throw new DiffwikiError(`gh pr create failed: ${(res.stderr || res.stdout).trim()}`);
    }
    const urlLine = res.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /\/pull\/\d+\b/.test(l));
    if (urlLine) {
      const match = /\/pull\/(\d+)\b/.exec(urlLine);
      if (match) {
        return { number: Number.parseInt(match[1], 10), url: urlLine, conflictFree: true };
      }
    }
    const lookedUp = await this.findOpenChangeRequest({
      headBranch: opts.headBranch,
      baseBranch: opts.baseBranch,
    });
    if (!lookedUp) {
      throw new DiffwikiError(`gh pr create succeeded, failed to locate created pull request: ${res.stdout.trim()}`);
    }
    return lookedUp;
  }

  async updateChangeRequest(opts: { number: number; title?: string; body?: string }): Promise<void> {
    if (opts.title === undefined && opts.body === undefined) return;
    const args = ['pr', 'edit', String(opts.number), '-R', this.repoSlug];
    if (opts.title !== undefined) args.push('--title', opts.title);
    if (opts.body !== undefined) args.push('--body', opts.body);
    const res = await this.runner('gh', args);
    if (res.exitCode !== 0) {
      throw new DiffwikiError(`gh pr edit failed: ${(res.stderr || res.stdout).trim()}`);
    }
  }

  async squashMergeChangeRequest(opts: { number: number }): Promise<void> {
    const res = await this.runner('gh', ['pr', 'merge', String(opts.number), '-R', this.repoSlug, '--squash']);
    if (res.exitCode !== 0) {
      throw new DiffwikiError(`gh pr merge failed: ${(res.stderr || res.stdout).trim()}`);
    }
  }
}

export function parseGitHubRemote(input: string, ghHost = process.env.GH_HOST): ParsedGitHubRemote | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const allowedHosts = new Set(['github.com']);
  if (ghHost && ghHost.trim().length > 0) {
    allowedHosts.add(ghHost.trim().toLowerCase());
  }

  // 1. Bare "<owner>/<repo>" shorthand (no scheme, colon, or extra slashes).
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (shorthand && !trimmed.includes('..')) {
    const owner = shorthand[1];
    const repo = stripDotGit(shorthand[2]);
    if (isSafeSegment(owner) && isSafeSegment(repo)) {
      return {
        host: 'github.com',
        owner,
        repo,
        repoSlug: `${owner}/${repo}`,
        remoteUrl: `https://github.com/${owner}/${repo}.git`,
      };
    }
  }

  // 2. HTTPS URL: https://<host>/<owner>/<repo>(.git)(/)
  const httpsMatch = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i.exec(trimmed);
  if (httpsMatch) {
    const host = httpsMatch[1].toLowerCase();
    const owner = httpsMatch[2];
    const repo = stripDotGit(httpsMatch[3]);
    if (allowedHosts.has(host) && isSafeSegment(owner) && isSafeSegment(repo)) {
      return {
        host,
        owner,
        repo,
        repoSlug: formatRepoSlug(host, owner, repo),
        remoteUrl: `https://${host}/${owner}/${repo}.git`,
      };
    }
    return null;
  }

  // 3. SCP-like SSH URL: git@<host>:<owner>/<repo>(.git)
  const scpMatch = /^git@([^:]+):([^/]+)\/([^/]+?)\/?$/i.exec(trimmed);
  if (scpMatch) {
    const host = scpMatch[1].toLowerCase();
    const owner = scpMatch[2];
    const repo = stripDotGit(scpMatch[3]);
    if (allowedHosts.has(host) && isSafeSegment(owner) && isSafeSegment(repo)) {
      return {
        host,
        owner,
        repo,
        repoSlug: formatRepoSlug(host, owner, repo),
        remoteUrl: `git@${host}:${owner}/${repo}.git`,
      };
    }
    return null;
  }

  // 4. ssh://git@<host>/<owner>/<repo>(.git)(/)
  const sshMatch = /^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/]+?)\/?$/i.exec(trimmed);
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase();
    const owner = sshMatch[2];
    const repo = stripDotGit(sshMatch[3]);
    if (allowedHosts.has(host) && isSafeSegment(owner) && isSafeSegment(repo)) {
      return {
        host,
        owner,
        repo,
        repoSlug: formatRepoSlug(host, owner, repo),
        remoteUrl: `ssh://git@${host}/${owner}/${repo}.git`,
      };
    }
    return null;
  }

  return null;
}

export function resolveForge(remoteUrl: string, runner: CommandRunner = defaultCommandRunner): ForgeAdapter {
  const github = parseGitHubRemote(remoteUrl);
  if (github) {
    return new GitHubForge(github, runner);
  }
  throw new UnsupportedForgeError(remoteUrl);
}

// helpers ---------------------------------------------------------------------

function stripDotGit(segment: string): string {
  return segment.replace(/\.git$/i, '');
}

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== '.' && segment !== '..' && /^[A-Za-z0-9_.-]+$/.test(segment);
}

function formatRepoSlug(host: string, owner: string, repo: string): string {
  return host === 'github.com' ? `${owner}/${repo}` : `${host}/${owner}/${repo}`;
}
