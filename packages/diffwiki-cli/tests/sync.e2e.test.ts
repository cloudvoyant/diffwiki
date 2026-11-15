import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYNC_GITIGNORE_ENTRIES } from 'diffwiki-core';
import { run } from './helpers';

const execFileAsync = promisify(execFile);

interface GhCallRecord {
  args: string[];
}

interface GhStubPr {
  number: number;
  repo: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  url: string;
  state: 'OPEN' | 'MERGED';
  mergeable: 'MERGEABLE' | 'CONFLICTING';
  mergeStateStatus: 'CLEAN' | 'DIRTY';
}

interface GhStubState {
  login: string;
  nextNumber: number;
  bareBySlug: Record<string, string>;
  prs: GhStubPr[];
}

let fallbackHome: string;
let initialDiffwikiHome: string | undefined;
let sandbox: string;
let home: string;
let bareDir: string;
let otherBareDir: string;
let ghStatePath: string;
let ghCallsPath: string;
let savedEnv: Record<string, string | undefined>;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: process.env });
  return String(stdout).trim();
}

async function readGhCalls(): Promise<GhCallRecord[]> {
  try {
    const raw = await fs.readFile(ghCallsPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GhCallRecord);
  } catch {
    return [];
  }
}

async function clearGhCalls(): Promise<void> {
  await fs.rm(ghCallsPath, { force: true });
}

async function commitToRemoteMain(
  mutate: (workDir: string) => Promise<void>,
  message = 'chore: upstream update',
): Promise<void> {
  const workDir = path.join(sandbox, `upstream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await execFileAsync('git', ['clone', bareDir, workDir], { env: process.env });
  const hasMain = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], {
    cwd: workDir,
    env: process.env,
  })
    .then(() => true)
    .catch(() => false);
  if (hasMain) {
    await git(workDir, ['checkout', '-B', 'main', 'refs/remotes/origin/main']);
  } else {
    await git(workDir, ['checkout', '-B', 'main']);
  }
  await mutate(workDir);
  await git(workDir, ['add', '-A']);
  await git(workDir, ['commit', '-m', message]);
  await git(workDir, ['push', 'origin', 'main']);
  await fs.rm(workDir, { recursive: true, force: true });
}

async function installGhStub(): Promise<string> {
  const binDir = path.join(sandbox, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  const initialState: GhStubState = {
    login: 'alice',
    nextNumber: 1,
    bareBySlug: {
      'acme/wiki': bareDir,
      'acme/other-wiki': otherBareDir,
    },
    prs: [],
  };
  await fs.writeFile(ghStatePath, JSON.stringify(initialState, null, 2), 'utf8');

  const ghScript = `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const statePath = process.env.DW_TEST_GH_STATE;
const callsPath = process.env.DW_TEST_GH_CALLS;
const args = process.argv.slice(2);
fs.appendFileSync(callsPath, JSON.stringify({ args }) + '\\n', 'utf8');

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

function flagValue(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (args[0] === '--version') {
  console.log('gh version 2.60.0 (stub)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log('Logged in to github.com account ' + state.login);
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'user') {
  console.log(state.login);
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'list') {
  const repo = flagValue('-R');
  const head = flagValue('--head');
  const base = flagValue('--base');
  const open = state.prs.filter(
    (p) => p.state === 'OPEN' && p.repo === repo && p.headBranch === head && p.baseBranch === base,
  );
  console.log(
    JSON.stringify(
      open.map((p) => ({
        number: p.number,
        url: p.url,
        mergeable: p.mergeable,
        mergeStateStatus: p.mergeStateStatus,
      })),
    ),
  );
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
  const repo = flagValue('-R');
  const headBranch = flagValue('--head');
  const baseBranch = flagValue('--base');
  const title = flagValue('--title') || '';
  const body = flagValue('--body') || '';
  const num = state.nextNumber++;
  const url = 'https://github.com/' + repo + '/pull/' + num;
  state.prs.push({
    number: num,
    repo,
    headBranch,
    baseBranch,
    title,
    body,
    url,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
  });
  save();
  console.log(url);
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'edit') {
  const num = Number(args[2]);
  const repo = flagValue('-R');
  const pr = state.prs.find((p) => p.number === num && p.repo === repo);
  if (!pr) {
    console.error('PR not found');
    process.exit(1);
  }
  const title = flagValue('--title');
  const body = flagValue('--body');
  if (title !== undefined) pr.title = title;
  if (body !== undefined) pr.body = body;
  save();
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'merge') {
  const num = Number(args[2]);
  const repo = flagValue('-R');
  const pr = state.prs.find((p) => p.number === num && p.repo === repo && p.state === 'OPEN');
  if (!pr) {
    console.error('Open PR not found');
    process.exit(1);
  }
  const bare = state.bareBySlug[repo];
  if (bare) {
    const tree = execFileSync('git', ['rev-parse', 'refs/heads/' + pr.headBranch + '^{tree}'], { cwd: bare })
      .toString()
      .trim();
    const parent = execFileSync('git', ['rev-parse', 'refs/heads/' + pr.baseBranch], { cwd: bare })
      .toString()
      .trim();
    const commit = execFileSync('git', ['commit-tree', tree, '-p', parent, '-m', 'squash merge PR #' + num], {
      cwd: bare,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'GitHub',
        GIT_AUTHOR_EMAIL: 'noreply@github.com',
        GIT_COMMITTER_NAME: 'GitHub',
        GIT_COMMITTER_EMAIL: 'noreply@github.com',
      },
    })
      .toString()
      .trim();
    execFileSync('git', ['update-ref', 'refs/heads/' + pr.baseBranch, commit], { cwd: bare });
  }
  pr.state = 'MERGED';
  save();
  console.log('Merged PR #' + num);
  process.exit(0);
}
console.error('Unhandled gh command: ' + args.join(' '));
process.exit(1);
`;
  const ghBin = path.join(binDir, 'gh');
  await fs.writeFile(ghBin, ghScript, { mode: 0o755 });
  return binDir;
}

beforeAll(async () => {
  initialDiffwikiHome = process.env.DIFFWIKI_HOME;
  fallbackHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-sync-fallback-')));
  process.env.DIFFWIKI_HOME = fallbackHome;
});

afterAll(async () => {
  if (initialDiffwikiHome === undefined) delete process.env.DIFFWIKI_HOME;
  else process.env.DIFFWIKI_HOME = initialDiffwikiHome;
  await fs.rm(fallbackHome, { recursive: true, force: true });
});

beforeEach(async () => {
  sandbox = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-sync-e2e-')));
  home = path.join(sandbox, 'home');
  bareDir = path.join(sandbox, 'remote.git');
  otherBareDir = path.join(sandbox, 'other-remote.git');
  ghStatePath = path.join(sandbox, 'gh-state.json');
  ghCallsPath = path.join(sandbox, 'gh-calls.jsonl');

  await fs.mkdir(home, { recursive: true });
  await execFileAsync('git', ['init', '--bare', '--initial-branch=main', bareDir]);
  await execFileAsync('git', ['init', '--bare', '--initial-branch=main', otherBareDir]);

  const gitConfigGlobal = path.join(sandbox, 'gitconfig');
  await fs.writeFile(gitConfigGlobal, '', 'utf8');
  await execFileAsync('git', ['config', '--file', gitConfigGlobal, 'user.name', 'Alice Developer']);
  await execFileAsync('git', ['config', '--file', gitConfigGlobal, 'user.email', 'alice@example.com']);
  await execFileAsync('git', [
    'config',
    '--file',
    gitConfigGlobal,
    `url.${bareDir}.insteadOf`,
    'https://github.com/acme/wiki.git',
  ]);
  await execFileAsync('git', [
    'config',
    '--file',
    gitConfigGlobal,
    `url.${otherBareDir}.insteadOf`,
    'https://github.com/acme/other-wiki.git',
  ]);

  const binDir = await installGhStub();

  savedEnv = {
    DIFFWIKI_HOME: process.env.DIFFWIKI_HOME,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    DW_TEST_GH_STATE: process.env.DW_TEST_GH_STATE,
    DW_TEST_GH_CALLS: process.env.DW_TEST_GH_CALLS,
    PATH: process.env.PATH,
  };
  process.env.DIFFWIKI_HOME = home;
  process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.DW_TEST_GH_STATE = ghStatePath;
  process.env.DW_TEST_GH_CALLS = ghCallsPath;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (k === 'DIFFWIKI_HOME') process.env.DIFFWIKI_HOME = fallbackHome;
    else if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe('given an unlinked home with existing articles, drafts, search index dirs, logs/, ui.json, and dist-site/', () => {
  beforeEach(async () => {
    await commitToRemoteMain(async (workDir) => {
      await fs.mkdir(path.join(workDir, 'collections', 'shared'), { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'welcome.md'),
        '---\ntitle: Welcome\n---\n\n# Welcome\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(workDir, 'registry.json'),
        JSON.stringify(
          {
            version: 1,
            collections: [
              {
                name: 'shared',
                type: 'global',
                path: '/Users/other-machine/.diffwiki/collections/shared',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );
    }, 'feat: seed remote wiki');

    await run(['collection', 'create', 'local-notes']);
    await run(['article', 'create', 'local-notes:Published Guide', '-b', '# Published Guide', '-t', 'ops']);
    await run(['article', 'create', 'local-notes:Draft Idea', '-b', '# Draft Idea', '--status', 'draft', '-t', 'wip']);

    for (const rel of [
      'qmd/index.sqlite',
      'stripped/doc.md',
      'plugins/node_modules/pkg/index.js',
      'logs/diffwiki.log',
      'dist-site/index.html',
    ]) {
      const target = path.join(home, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'runtime-artifact\n', 'utf8');
    }
    await fs.writeFile(path.join(home, 'ui.json'), '{"pid":99999,"port":4321}\n', 'utf8');
  });

  it('moves local work onto user/<username>, ignores index/log/UI paths, and rewrites pulled global collection paths to DIFFWIKI_HOME when diffwiki link <owner/repo> --json runs', async () => {
    // Arrange
    const expectedSharedPath = path.join(home, 'collections', 'shared');

    // Act
    const linked = await run(['link', 'acme/wiki', '--json']);

    // Assert
    expect(linked.ok, linked.err).toBe(true);
    const parsed = JSON.parse(linked.out) as {
      branch: string;
      forge: string;
      movedLocalWork: boolean;
      reconciledCollections: string[];
    };
    expect(parsed.branch).toBe('user/alice');
    expect(parsed.forge).toBe('github');
    expect(parsed.movedLocalWork).toBe(true);
    expect(parsed.reconciledCollections).toEqual(['local-notes', 'shared']);
    expect(await git(home, ['branch', '--show-current'])).toBe('user/alice');

    const gitignore = await fs.readFile(path.join(home, '.gitignore'), 'utf8');
    for (const entry of SYNC_GITIGNORE_ENTRIES) {
      expect(gitignore).toContain(entry);
    }
    const trackedRuntime = await git(home, ['ls-files', 'qmd', 'stripped', 'plugins', 'logs', 'ui.json', 'dist-site']);
    expect(trackedRuntime).toBe('');
    await fs.access(path.join(home, 'logs', 'diffwiki.log'));
    await fs.access(path.join(home, 'ui.json'));
    await fs.access(path.join(home, 'dist-site', 'index.html'));
    await fs.access(path.join(home, 'collections', 'local-notes', 'published-guide.md'));
    await fs.access(path.join(home, 'collections', 'local-notes', 'draft-idea.md'));

    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8')) as {
      collections: Array<{ name: string; type: string; path: string }>;
    };
    const sharedEntry = registry.collections.find((c) => c.name === 'shared');
    expect(sharedEntry?.path).toBe(expectedSharedPath);
  });

  it('exits non-zero with UnsupportedForgeError when diffwiki link https://gitlab.com/acme/wiki.git runs', async () => {
    // Arrange
    const gitlabUrl = 'https://gitlab.com/acme/wiki.git';

    // Act
    const res = await run(['link', gitlabUrl]);

    // Assert
    expect(res.ok).toBe(false);
    expect(res.err).toContain('UnsupportedForgeError');
  });

  it('exits non-zero with SyncRemoteExistsError when linked to a different GitHub remote without --force', async () => {
    // Arrange
    expect((await run(['link', 'acme/wiki'])).ok).toBe(true);

    // Act
    const second = await run(['link', 'acme/other-wiki']);

    // Assert
    expect(second.ok).toBe(false);
    expect(second.err).toContain('SyncRemoteExistsError');
  });

  it('replaces the origin remote cleanly when relinking with --force', async () => {
    // Arrange
    await run(['link', 'acme/wiki']);

    // Act
    const relinked = await run(['link', 'acme/other-wiki', '--force', '--json']);

    // Assert
    expect(relinked.ok, relinked.err).toBe(true);
    const parsed = JSON.parse(relinked.out) as { remoteUrl: string; branch: string };
    expect(parsed.remoteUrl).toBe('https://github.com/acme/other-wiki.git');
    expect(parsed.branch).toBe('user/alice');
  });
});

describe('given a linked home on user/<username> in sync with origin/main (no open PR)', () => {
  beforeEach(async () => {
    await run(['link', 'acme/wiki']);
    await clearGhCalls();
  });

  it('pushes only non-draft changes to origin/user/<username>, opens one PR (prCreated: true), and keeps the draft file on disk', async () => {
    // Arrange
    await run(['collection', 'create', 'eng']);
    await run(['article', 'create', 'eng:Release Checklist', '-b', '# Checklist', '-t', 'release']);
    const draftCreated = await run([
      'article',
      'create',
      'eng:Unfinished RFC',
      '-b',
      '# WIP',
      '--status',
      'draft',
      '-t',
      'rfc',
    ]);
    const draftPath = draftCreated.out.trim();

    // Act
    const pushed = await run(['push', '--json']);

    // Assert
    expect(pushed.ok, pushed.err).toBe(true);
    const result = JSON.parse(pushed.out) as {
      branch: string;
      prCreated: boolean;
      prNumber: number;
      prUrl: string;
      excludedDrafts: string[];
    };
    expect(result.branch).toBe('user/alice');
    expect(result.prCreated).toBe(true);
    expect(result.prNumber).toBe(1);
    expect(result.prUrl).toBe('https://github.com/acme/wiki/pull/1');
    expect(result.excludedDrafts).toContain('collections/eng/unfinished-rfc.md');

    const remoteFiles = await git(bareDir, ['ls-tree', '-r', '--name-only', 'refs/heads/user/alice']);
    expect(remoteFiles).toContain('collections/eng/release-checklist.md');
    expect(remoteFiles).not.toContain('collections/eng/unfinished-rfc.md');
    await fs.access(draftPath);

    const createCalls = (await readGhCalls()).filter((c) => c.args[0] === 'pr' && c.args[1] === 'create');
    expect(createCalls).toHaveLength(1);
  });
});

describe('given a linked home on user/<username> with an open PR on origin', () => {
  let draftPath: string;

  beforeEach(async () => {
    await run(['link', 'acme/wiki']);
    await run(['collection', 'create', 'eng']);
    await run(['article', 'create', 'eng:Initial Spec', '-b', '# Spec v1', '-t', 'spec']);
    const draftCreated = await run([
      'article',
      'create',
      'eng:Secret Draft',
      '-b',
      '# Draft body',
      '--status',
      'draft',
      '-t',
      'draft',
    ]);
    draftPath = draftCreated.out.trim();
    const firstPush = await run(['push', '--json']);
    expect(firstPush.ok, firstPush.err).toBe(true);
    await clearGhCalls();
  });

  it('updates origin/user/<username>, joins the existing open PR (prCreated: false), and never calls gh pr create again', async () => {
    // Arrange
    await run(['article', 'create', 'eng:Second Spec', '-b', '# Spec v2', '-t', 'spec']);

    // Act
    const secondPush = await run(['push', '--json']);

    // Assert
    expect(secondPush.ok, secondPush.err).toBe(true);
    const result = JSON.parse(secondPush.out) as {
      prCreated: boolean;
      prNumber: number;
      prUrl: string;
      pushed: boolean;
    };
    expect(result.pushed).toBe(true);
    expect(result.prCreated).toBe(false);
    expect(result.prNumber).toBe(1);
    expect(result.prUrl).toBe('https://github.com/acme/wiki/pull/1');

    const calls = await readGhCalls();
    expect(calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'create')).toHaveLength(0);
    const remoteFiles = await git(bareDir, ['ls-tree', '-r', '--name-only', 'refs/heads/user/alice']);
    expect(remoteFiles).toContain('collections/eng/second-spec.md');
    expect(remoteFiles).not.toContain('collections/eng/secret-draft.md');
  });

  it('adds the draft article to that same open PR (prCreated: false) when diffwiki push --include-drafts runs', async () => {
    // Arrange
    await fs.access(draftPath);

    // Act
    const pushed = await run(['push', '--include-drafts', '--json']);

    // Assert
    expect(pushed.ok, pushed.err).toBe(true);
    const result = JSON.parse(pushed.out) as {
      prCreated: boolean;
      prNumber: number;
      excludedDrafts: string[];
    };
    expect(result.prCreated).toBe(false);
    expect(result.prNumber).toBe(1);
    expect(result.excludedDrafts).toEqual([]);

    const remoteFiles = await git(bareDir, ['ls-tree', '-r', '--name-only', 'refs/heads/user/alice']);
    expect(remoteFiles).toContain('collections/eng/secret-draft.md');
    const calls = await readGhCalls();
    expect(calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'create')).toHaveLength(0);
  });

  it('joins the open PR even with zero new local edits, invokes gh pr merge --squash, and updates local main when diffwiki push --merge runs', async () => {
    // Arrange — no new published edits since the open PR was created

    // Act
    const merged = await run(['push', '--merge', '--json']);

    // Assert
    expect(merged.ok, merged.err).toBe(true);
    const result = JSON.parse(merged.out) as {
      committed: boolean;
      prCreated: boolean;
      prNumber: number;
      merged: boolean;
    };
    expect(result.committed).toBe(false);
    expect(result.prCreated).toBe(false);
    expect(result.prNumber).toBe(1);
    expect(result.merged).toBe(true);

    const calls = await readGhCalls();
    const mergeCalls = calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'merge');
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0].args).toContain('--squash');

    const localMainTree = await git(home, ['ls-tree', '-r', '--name-only', 'refs/heads/main']);
    expect(localMainTree).toContain('collections/eng/initial-spec.md');
    await fs.access(draftPath);
  });
});

describe('given a linked home on user/<username> after a prior PR merged on origin', () => {
  beforeEach(async () => {
    await run(['link', 'acme/wiki']);
    await run(['collection', 'create', 'eng']);
    await run(['article', 'create', 'eng:First Batch', '-b', '# Batch 1', '-t', 'ops']);
    await run(['push', '--merge']);
    await clearGhCalls();
  });

  it('opens a fresh PR (prCreated: true) when diffwiki push runs with new published commits', async () => {
    // Arrange
    await run(['article', 'create', 'eng:Second Batch', '-b', '# Batch 2', '-t', 'ops']);

    // Act
    const nextPush = await run(['push', '--json']);

    // Assert
    expect(nextPush.ok, nextPush.err).toBe(true);
    const result = JSON.parse(nextPush.out) as {
      prCreated: boolean;
      prNumber: number;
      prUrl: string;
    };
    expect(result.prCreated).toBe(true);
    expect(result.prNumber).toBe(2);
    expect(result.prUrl).toBe('https://github.com/acme/wiki/pull/2');
  });
});

describe('given a linked home on user/<username> behind an advanced origin/main', () => {
  beforeEach(async () => {
    await commitToRemoteMain(async (workDir) => {
      await fs.mkdir(path.join(workDir, 'collections', 'shared'), { recursive: true });
      await fs.mkdir(path.join(workDir, 'collections', 'obsolete'), { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'runbook.md'),
        '---\ntitle: Runbook\n---\n\nDeploy target: staging\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(workDir, 'collections', 'obsolete', 'old.md'),
        '---\ntitle: Old\n---\n\nLegacy note\n',
        'utf8',
      );
    }, 'feat: seed shared and obsolete collections');

    await run(['link', 'acme/wiki']);
  });

  it('rebases preferring remote lines and preserves uncommitted drafts on disk when diffwiki pull runs with defaults', async () => {
    // Arrange
    const runbookPath = path.join(home, 'collections', 'shared', 'runbook.md');
    await fs.writeFile(runbookPath, '---\ntitle: Runbook\n---\n\nDeploy target: local-branch\n', 'utf8');
    await git(home, ['add', 'collections/shared/runbook.md']);
    await git(home, ['commit', '-m', 'docs: local runbook change']);

    const draftCreated = await run([
      'article',
      'create',
      'shared:Local Draft',
      '-b',
      '# Draft kept dirty',
      '--status',
      'draft',
    ]);
    const draftPath = draftCreated.out.trim();

    await commitToRemoteMain(async (workDir) => {
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'runbook.md'),
        '---\ntitle: Runbook\n---\n\nDeploy target: production-remote\n',
        'utf8',
      );
    }, 'docs: upstream runbook update');

    // Act
    const pulled = await run(['pull', '--json']);

    // Assert
    expect(pulled.ok, pulled.err).toBe(true);
    const content = await fs.readFile(runbookPath, 'utf8');
    expect(content).toContain('Deploy target: production-remote');
    await fs.access(draftPath);
  });

  it('prunes a deleted global collection from registry.json when origin/main deletes the collection and diffwiki pull runs', async () => {
    // Arrange
    await commitToRemoteMain(async (workDir) => {
      await fs.rm(path.join(workDir, 'collections', 'obsolete'), { recursive: true, force: true });
    }, 'chore: remove obsolete collection');

    // Act
    const pulled = await run(['pull', '--json']);

    // Assert
    expect(pulled.ok, pulled.err).toBe(true);
    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8')) as {
      collections: Array<{ name: string }>;
    };
    expect(registry.collections.map((c) => c.name)).not.toContain('obsolete');
    expect(registry.collections.map((c) => c.name)).toContain('shared');
  });

  it('keeps local lines when diffwiki pull --prefer local runs on a conflicting edit', async () => {
    // Arrange
    const runbookPath = path.join(home, 'collections', 'shared', 'runbook.md');
    await fs.writeFile(runbookPath, '---\ntitle: Runbook\n---\n\nDeploy target: local-winner\n', 'utf8');
    await git(home, ['add', 'collections/shared/runbook.md']);
    await git(home, ['commit', '-m', 'docs: local winner edit']);

    await commitToRemoteMain(async (workDir) => {
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'runbook.md'),
        '---\ntitle: Runbook\n---\n\nDeploy target: remote-loser\n',
        'utf8',
      );
    }, 'docs: upstream edit');

    // Act
    const pulled = await run(['pull', '--prefer', 'local', '--json']);

    // Assert
    expect(pulled.ok, pulled.err).toBe(true);
    const content = await fs.readFile(runbookPath, 'utf8');
    expect(content).toContain('Deploy target: local-winner');
  });

  it('exits non-zero listing conflicted files when diffwiki pull --prefer manual hits a conflict', async () => {
    // Arrange
    const runbookPath = path.join(home, 'collections', 'shared', 'runbook.md');
    await fs.writeFile(runbookPath, '---\ntitle: Runbook\n---\n\nDeploy target: manual-local\n', 'utf8');
    await git(home, ['add', 'collections/shared/runbook.md']);
    await git(home, ['commit', '-m', 'docs: local manual conflict']);

    await commitToRemoteMain(async (workDir) => {
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'runbook.md'),
        '---\ntitle: Runbook\n---\n\nDeploy target: manual-remote\n',
        'utf8',
      );
    }, 'docs: upstream manual conflict');

    // Act
    const pulled = await run(['pull', '--prefer', 'manual']);

    // Assert
    expect(pulled.ok).toBe(false);
    expect(pulled.err).toContain('collections/shared/runbook.md');
    expect(pulled.err).toContain('diffwiki pull --abort');
  });

  it('restores the branch cleanly when diffwiki pull --abort runs after a manual conflict', async () => {
    // Arrange
    const runbookPath = path.join(home, 'collections', 'shared', 'runbook.md');
    await fs.writeFile(runbookPath, '---\ntitle: Runbook\n---\n\nDeploy target: before-abort\n', 'utf8');
    await git(home, ['add', 'collections/shared/runbook.md']);
    await git(home, ['commit', '-m', 'docs: local before abort']);
    const prePullSha = await git(home, ['rev-parse', 'HEAD']);

    await commitToRemoteMain(async (workDir) => {
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'runbook.md'),
        '---\ntitle: Runbook\n---\n\nDeploy target: upstream-conflict\n',
        'utf8',
      );
    }, 'docs: upstream conflict');
    await run(['pull', '--prefer', 'manual']);

    // Act
    const aborted = await run(['pull', '--abort', '--json']);

    // Assert
    expect(aborted.ok, aborted.err).toBe(true);
    expect(await git(home, ['rev-parse', 'HEAD'])).toBe(prePullSha);
    expect(await fs.readFile(runbookPath, 'utf8')).toContain('Deploy target: before-abort');
  });

  it('rebases onto origin/main before pushing and opening the PR when diffwiki push runs while behind origin/main', async () => {
    // Arrange
    await commitToRemoteMain(async (workDir) => {
      await fs.writeFile(
        path.join(workDir, 'collections', 'shared', 'upstream-added.md'),
        '---\ntitle: Upstream Added\n---\n\n# Upstream\n',
        'utf8',
      );
    }, 'docs: add upstream article');
    await run(['article', 'create', 'shared:Local Added', '-b', '# Local', '-t', 'sync']);

    // Act
    const pushed = await run(['push', '--json']);

    // Assert
    expect(pushed.ok, pushed.err).toBe(true);
    const parsed = JSON.parse(pushed.out) as { prCreated: boolean; pushed: boolean };
    expect(parsed.pushed).toBe(true);
    expect(parsed.prCreated).toBe(true);

    const remoteTree = await git(bareDir, ['ls-tree', '-r', '--name-only', 'refs/heads/user/alice']);
    expect(remoteTree).toContain('collections/shared/upstream-added.md');
    expect(remoteTree).toContain('collections/shared/local-added.md');
  });
});
