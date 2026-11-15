import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultCommandRunner,
  ForgeUnavailableError,
  GitHubForge,
  linkHome,
  pullHome,
  pushHome,
  readRegistry,
  reconcileGlobalRegistry,
  resolveForge,
  SyncConflictError,
  UnsupportedForgeError,
  writeRegistry,
} from '../src/index';
import type { CommandRunner, ForgeAdapter, ForgeChangeRequest } from '../src/index';

interface GhCall {
  args: string[];
}

interface TestHarness {
  rootDir: string;
  homeDir: string;
  bareRemoteDir: string;
  gitConfigPath: string;
  runner: CommandRunner;
  ghCalls: GhCall[];
  openPr: ForgeChangeRequest | null;
  ghAvailable: boolean;
  onSquashMerge?: () => Promise<void>;
}

let fallbackHome: string;
let initialDiffwikiHome: string | undefined;
let harness: TestHarness;

async function setupHarness(): Promise<TestHarness> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-sync-unit-'));
  const homeDir = path.join(rootDir, 'home');
  const bareRemoteDir = path.join(rootDir, 'remote.git');
  const gitConfigPath = path.join(rootDir, 'gitconfig');
  await fs.mkdir(homeDir, { recursive: true });
  await defaultCommandRunner('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);

  await fs.writeFile(
    gitConfigPath,
    [
      '[user]',
      '\tname = Test Author',
      '\temail = author@example.com',
      `[url "${bareRemoteDir}"]`,
      '\tinsteadOf = https://github.com/acme/wiki.git',
      `[url "${bareRemoteDir}"]`,
      '\tinsteadOf = https://gitlab.example/group/wiki.git',
      '',
    ].join('\n'),
    'utf8',
  );

  const ghCalls: GhCall[] = [];
  const state: TestHarness = {
    rootDir,
    homeDir,
    bareRemoteDir,
    gitConfigPath,
    ghCalls,
    openPr: null,
    ghAvailable: true,
    runner: async (cmd, args, opts) => {
      if (cmd === 'gh') {
        ghCalls.push({ args });
        if (!state.ghAvailable) {
          return { exitCode: 1, stdout: '', stderr: 'not logged into any GitHub hosts' };
        }
        if (args[0] === '--version') {
          return { exitCode: 0, stdout: 'gh version 2.60.0\n', stderr: '' };
        }
        if (args[0] === 'auth' && args[1] === 'status') {
          return { exitCode: 0, stdout: 'Logged in to github.com\n', stderr: '' };
        }
        if (args[0] === 'api' && args[1] === 'user') {
          return { exitCode: 0, stdout: 'alice\n', stderr: '' };
        }
        if (args[0] === 'pr' && args[1] === 'list') {
          const items = state.openPr
            ? [
                {
                  number: state.openPr.number,
                  url: state.openPr.url,
                  mergeable: state.openPr.conflictFree ? 'MERGEABLE' : 'CONFLICTING',
                  mergeStateStatus: state.openPr.conflictFree ? 'CLEAN' : 'DIRTY',
                },
              ]
            : [];
          return { exitCode: 0, stdout: `${JSON.stringify(items)}\n`, stderr: '' };
        }
        if (args[0] === 'pr' && args[1] === 'create') {
          state.openPr = {
            number: 11,
            url: 'https://github.com/acme/wiki/pull/11',
            conflictFree: true,
          };
          return { exitCode: 0, stdout: `${state.openPr.url}\n`, stderr: '' };
        }
        if (args[0] === 'pr' && args[1] === 'edit') {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'pr' && args[1] === 'merge') {
          if (state.onSquashMerge) await state.onSquashMerge();
          state.openPr = null;
          return { exitCode: 0, stdout: 'Merged!\n', stderr: '' };
        }
      }
      return defaultCommandRunner(cmd, args, {
        ...opts,
        env: {
          ...opts?.env,
          GIT_CONFIG_GLOBAL: gitConfigPath,
          GIT_CONFIG_NOSYSTEM: '1',
        },
      });
    },
  };
  return state;
}

async function commitToRemoteMain(files: Record<string, string>, message = 'upstream update'): Promise<void> {
  const workDir = await fs.mkdtemp(path.join(harness.rootDir, 'upstream-'));
  try {
    await harness.runner('git', ['clone', harness.bareRemoteDir, workDir]);
    const hasMain =
      (await harness.runner('git', ['rev-parse', '--verify', 'refs/remotes/origin/main'], { cwd: workDir }))
        .exitCode === 0;
    if (hasMain) {
      await harness.runner('git', ['checkout', '-B', 'main', 'refs/remotes/origin/main'], { cwd: workDir });
    } else {
      await harness.runner('git', ['checkout', '-B', 'main'], { cwd: workDir });
    }
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(workDir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }
    await harness.runner('git', ['add', '-A'], { cwd: workDir });
    await harness.runner('git', ['commit', '-m', message], { cwd: workDir });
    await harness.runner('git', ['push', 'origin', 'main'], { cwd: workDir });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  initialDiffwikiHome = process.env.DIFFWIKI_HOME;
  fallbackHome = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-sync-unit-fallback-'));
  process.env.DIFFWIKI_HOME = fallbackHome;
});

afterAll(async () => {
  if (initialDiffwikiHome === undefined) delete process.env.DIFFWIKI_HOME;
  else process.env.DIFFWIKI_HOME = initialDiffwikiHome;
  await fs.rm(fallbackHome, { recursive: true, force: true });
});

beforeEach(async () => {
  harness = await setupHarness();
  process.env.DIFFWIKI_HOME = harness.homeDir;
});

afterEach(async () => {
  process.env.DIFFWIKI_HOME = fallbackHome;
  await fs.rm(harness.rootDir, { recursive: true, force: true });
});

describe('resolveForge', () => {
  it('resolves GitHub shorthand, HTTPS, and SSH remotes dynamically without hardcoded repos', () => {
    // Arrange
    const inputs = [
      'acme/wiki',
      'https://github.com/other-org/knowledge.git',
      'git@github.com:team-x/handbook.git',
      'ssh://git@github.com/team-y/notes',
    ];

    // Act
    const adapters = inputs.map((input) => resolveForge(input, harness.runner));

    // Assert
    expect(adapters.every((a) => a instanceof GitHubForge && a.kind === 'github')).toBe(true);
    expect(adapters.map((a) => a.repoSlug)).toEqual([
      'acme/wiki',
      'other-org/knowledge',
      'team-x/handbook',
      'team-y/notes',
    ]);
  });

  it('throws UnsupportedForgeError for non-GitHub remotes', () => {
    // Arrange
    const unsupported = ['https://gitlab.com/acme/wiki.git', 'git@bitbucket.org:acme/wiki.git', '/tmp/local-repo'];

    // Act & Assert
    for (const url of unsupported) {
      expect(() => resolveForge(url, harness.runner)).toThrow(UnsupportedForgeError);
    }
  });
});

describe('sync with custom ForgeAdapter', () => {
  it('completes link, open-MR join, and squash-merge using an injected GitLab ForgeAdapter', async () => {
    // Arrange
    let openMr: ForgeChangeRequest | null = null;
    let createCalls = 0;
    let mergeCalls = 0;
    const fakeGitLabForge: ForgeAdapter = {
      kind: 'gitlab',
      repoSlug: 'group/wiki',
      remoteUrl: 'https://gitlab.example/group/wiki.git',
      ensureAvailable: async () => {},
      resolveDefaultUser: async () => 'bob',
      findOpenChangeRequest: async () => openMr,
      createChangeRequest: async () => {
        createCalls += 1;
        openMr = { number: 7, url: 'https://gitlab.example/group/wiki/-/merge_requests/7', conflictFree: true };
        return openMr;
      },
      updateChangeRequest: async () => {},
      squashMergeChangeRequest: async () => {
        mergeCalls += 1;
        await harness.runner('git', ['fetch', harness.bareRemoteDir, 'user/bob:main'], { cwd: harness.bareRemoteDir });
        openMr = null;
      },
    };
    await linkHome({ repo: fakeGitLabForge.remoteUrl, forge: fakeGitLabForge, runner: harness.runner });
    await fs.mkdir(path.join(harness.homeDir, 'collections', 'notes'), { recursive: true });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'notes', 'first.md'),
      '---\ntitle: First\n---\nBody 1\n',
      'utf8',
    );
    const firstPush = await pushHome({ forge: fakeGitLabForge, runner: harness.runner });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'notes', 'second.md'),
      '---\ntitle: Second\n---\nBody 2\n',
      'utf8',
    );

    // Act
    const joinedPush = await pushHome({ forge: fakeGitLabForge, merge: true, runner: harness.runner });

    // Assert
    expect(firstPush.forge).toBe('gitlab');
    expect(firstPush.prCreated).toBe(true);
    expect(joinedPush.prCreated).toBe(false);
    expect(joinedPush.prNumber).toBe(7);
    expect(joinedPush.merged).toBe(true);
    expect(createCalls).toBe(1);
    expect(mergeCalls).toBe(1);
  });
});

describe('pushHome open PR join and draft handling', () => {
  it('joins an existing open PR without calling gh pr create or gh pr edit when title and body are omitted', async () => {
    // Arrange
    await linkHome({ repo: 'acme/wiki', runner: harness.runner });
    harness.openPr = {
      number: 42,
      url: 'https://github.com/acme/wiki/pull/42',
      conflictFree: true,
    };
    await fs.mkdir(path.join(harness.homeDir, 'collections', 'guides'), { recursive: true });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'guides', 'intro.md'),
      '---\ntitle: Intro\n---\nHello\n',
      'utf8',
    );
    harness.ghCalls.length = 0;

    // Act
    const result = await pushHome({ runner: harness.runner });

    // Assert
    expect(result.prCreated).toBe(false);
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe('https://github.com/acme/wiki/pull/42');
    expect(harness.ghCalls.some((c) => c.args[0] === 'pr' && c.args[1] === 'create')).toBe(false);
    expect(harness.ghCalls.some((c) => c.args[0] === 'pr' && c.args[1] === 'edit')).toBe(false);
  });

  it('omits draft edits when a previously published article on origin/main is flipped to status: draft', async () => {
    // Arrange
    await commitToRemoteMain({
      '.gitignore': 'qmd/\n',
      'collections/guides/published.md': '---\ntitle: Published\n---\nOriginal published text\n',
    });
    await linkHome({ repo: 'acme/wiki', runner: harness.runner });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'guides', 'published.md'),
      '---\ntitle: Published\nstatus: draft\n---\nWork in progress draft text\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'guides', 'other.md'),
      '---\ntitle: Other\n---\nReady to publish\n',
      'utf8',
    );

    // Act
    const result = await pushHome({ runner: harness.runner });

    // Assert
    expect(result.excludedDrafts).toEqual(['collections/guides/published.md']);
    const remoteBlob = await harness.runner('git', ['show', 'refs/heads/user/alice:collections/guides/published.md'], {
      cwd: harness.bareRemoteDir,
    });
    expect(remoteBlob.stdout).toContain('Original published text');
    expect(remoteBlob.stdout).not.toContain('Work in progress draft text');
    const localDisk = await fs.readFile(path.join(harness.homeDir, 'collections', 'guides', 'published.md'), 'utf8');
    expect(localDisk).toContain('Work in progress draft text');
  });

  it('throws ForgeUnavailableError when gh is missing or unauthenticated', async () => {
    // Arrange
    await linkHome({ repo: 'acme/wiki', user: 'alice', runner: harness.runner });
    harness.ghAvailable = false;

    // Act
    const action = pushHome({ runner: harness.runner });

    // Assert
    await expect(action).rejects.toBeInstanceOf(ForgeUnavailableError);
  });
});

describe('linkHome and reconcileGlobalRegistry', () => {
  it('untracks previously tracked logs, ui.json, and qmd from the Git index while keeping files on disk', async () => {
    // Arrange
    await harness.runner('git', ['init', '-b', 'main'], { cwd: harness.homeDir });
    await fs.mkdir(path.join(harness.homeDir, 'logs'), { recursive: true });
    await fs.mkdir(path.join(harness.homeDir, 'qmd'), { recursive: true });
    await fs.writeFile(path.join(harness.homeDir, 'logs', 'diffwiki.log'), 'log line\n', 'utf8');
    await fs.writeFile(path.join(harness.homeDir, 'ui.json'), '{"port":4444}\n', 'utf8');
    await fs.writeFile(path.join(harness.homeDir, 'qmd', 'index.sqlite'), 'sqlite', 'utf8');
    await harness.runner('git', ['add', '-f', 'logs/diffwiki.log', 'ui.json', 'qmd/index.sqlite'], {
      cwd: harness.homeDir,
    });
    await harness.runner('git', ['commit', '-m', 'legacy snapshot'], { cwd: harness.homeDir });

    // Act
    await linkHome({ repo: 'acme/wiki', runner: harness.runner });

    // Assert
    const tracked = await harness.runner('git', ['ls-files', 'logs', 'ui.json', 'qmd'], { cwd: harness.homeDir });
    expect(tracked.stdout.trim()).toBe('');
    await fs.access(path.join(harness.homeDir, 'logs', 'diffwiki.log'));
    await fs.access(path.join(harness.homeDir, 'ui.json'));
    await fs.access(path.join(harness.homeDir, 'qmd', 'index.sqlite'));
  });

  it('anchors .gitignore entries at home root so a collection named qmd or build stays tracked', async () => {
    // Arrange
    await fs.writeFile(path.join(harness.homeDir, '.gitignore'), 'qmd/\nplugins/\n', 'utf8');
    await fs.mkdir(path.join(harness.homeDir, 'qmd'), { recursive: true });
    await fs.writeFile(path.join(harness.homeDir, 'qmd', 'index.sqlite'), 'sqlite', 'utf8');
    await fs.mkdir(path.join(harness.homeDir, 'collections', 'qmd'), { recursive: true });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'qmd', 'search.md'),
      '---\ntitle: QMD Search\n---\nBody\n',
      'utf8',
    );

    // Act
    await linkHome({ repo: 'acme/wiki', runner: harness.runner });
    await pushHome({ runner: harness.runner });

    // Assert
    const remoteTree = await harness.runner('git', ['ls-tree', '-r', '--name-only', 'refs/heads/user/alice'], {
      cwd: harness.bareRemoteDir,
    });
    expect(remoteTree.stdout).toContain('collections/qmd/search.md');
    expect(remoteTree.stdout).not.toContain('qmd/index.sqlite');
  });

  it('rewrites global collection paths from another machine to resolveHome() and keeps repo entries untouched', async () => {
    // Arrange
    await fs.mkdir(path.join(harness.homeDir, 'collections', 'aws'), { recursive: true });
    await writeRegistry({
      version: 1,
      collections: [
        {
          name: 'aws',
          type: 'global',
          path: '/Users/other-machine/.diffwiki/collections/aws',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'gone',
          type: 'global',
          path: '/Users/other-machine/.diffwiki/collections/gone',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'app-docs',
          type: 'repo',
          path: '/Users/local/projects/app/wiki',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    // Act
    const reconciled = await reconcileGlobalRegistry(harness.homeDir);

    // Assert
    expect(reconciled).toEqual(['aws']);
    const registry = await readRegistry();
    expect(registry.collections).toEqual([
      {
        name: 'aws',
        type: 'global',
        path: path.join(harness.homeDir, 'collections', 'aws'),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        name: 'app-docs',
        type: 'repo',
        path: '/Users/local/projects/app/wiki',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('stops on manual conflict in pullHome and restores branch and stashed drafts on --abort', async () => {
    // Arrange
    await commitToRemoteMain({
      '.gitignore': 'qmd/\n',
      'collections/notes/topic.md': '---\ntitle: Topic\n---\nBaseline line\n',
    });
    await linkHome({ repo: 'acme/wiki', runner: harness.runner });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'notes', 'topic.md'),
      '---\ntitle: Topic\n---\nLocal committed line\n',
      'utf8',
    );
    await pushHome({ runner: harness.runner });
    await fs.writeFile(
      path.join(harness.homeDir, 'collections', 'notes', 'draft.md'),
      '---\ntitle: Draft\nstatus: draft\n---\nUncommitted draft\n',
      'utf8',
    );
    await commitToRemoteMain({
      'collections/notes/topic.md': '---\ntitle: Topic\n---\nConflicting upstream line\n',
    });

    // Act
    await expect(pullHome({ prefer: 'manual', runner: harness.runner })).rejects.toBeInstanceOf(SyncConflictError);
    const aborted = await pullHome({ abortRebase: true, runner: harness.runner });

    // Assert
    expect(aborted.rebased).toBe(false);
    const restoredTopic = await fs.readFile(path.join(harness.homeDir, 'collections', 'notes', 'topic.md'), 'utf8');
    const restoredDraft = await fs.readFile(path.join(harness.homeDir, 'collections', 'notes', 'draft.md'), 'utf8');
    expect(restoredTopic).toContain('Local committed line');
    expect(restoredDraft).toContain('Uncommitted draft');
  });
});
