import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/cli';
import * as uiServer from '../src/ui-server';

const exec = promisify(execFile);
const g = (cwd: string, args: string[]) => exec('git', args, { cwd });

let home: string;
let repo: string;
let originalCwd: string;

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-home-open-')));
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-repo-open-')));
  process.env.DIFFWIKI_HOME = home;
  originalCwd = process.cwd();
  await g(repo, ['init']);
  await g(repo, ['config', 'user.email', 't@t.dev']);
  await g(repo, ['config', 'user.name', 'T']);
  await g(repo, ['commit', '--allow-empty', '-m', 'init']);
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.DIFFWIKI_HOME;
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(repo, { recursive: true, force: true });
});

/**
 * Run the CLI but mock the heavy side-effects that we don't want in unit tests:
 * - startUi / waitForServer (we inject a fake running state instead)
 * - openBrowser (just capture the URL it would open)
 */
async function runOpen(args: string[], fakeUrl: string): Promise<{ openedUrl: string; consoleOut: string }> {
  // Inject a fake UI state so the 'open' command skips startUi.
  const fakeState: uiServer.UiState = { pid: process.pid, port: 9999, url: fakeUrl, startedAt: 'x' };
  vi.spyOn(uiServer, 'readState').mockResolvedValue(fakeState);
  vi.spyOn(uiServer, 'isAlive').mockReturnValue(true);

  let openedUrl = '';
  vi.spyOn(uiServer, 'openBrowser').mockImplementation((url: string) => {
    openedUrl = url;
  });

  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => out.push(parts.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await createProgram().parseAsync(['node', 'diffwiki', ...args]);
  return { openedUrl, consoleOut: out.join('\n') };
}

describe('diffwiki open — collection-root URL routing', () => {
  it('opens the bare UI url when cwd has no matching collection', async () => {
    // Use a temp dir that is not inside any registered collection.
    const stranger = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dw-stranger-')));
    try {
      process.chdir(stranger);
      const { openedUrl } = await runOpen(['open'], 'http://127.0.0.1:9999');
      expect(openedUrl).toBe('http://127.0.0.1:9999');
    } finally {
      await fs.rm(stranger, { recursive: true, force: true });
    }
  });

  it('opens the collection-scoped URL when cwd is inside a registered external collection', async () => {
    // Register the repo as an external collection.
    const docsDir = path.join(repo, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    // Register directly via registry so we don't need git remote.
    const { registerCollection } = await import('diffwiki-core');
    await registerCollection({
      name: 'my-repo',
      type: 'external',
      path: docsDir,
      createdAt: new Date().toISOString(),
      id: `path:${repo}`,
      repoRoot: repo,
    });

    process.chdir(repo);
    const { openedUrl } = await runOpen(['open'], 'http://127.0.0.1:9999');
    // Should navigate to the collection's root route, not bare home.
    expect(openedUrl).toBe('http://127.0.0.1:9999/my-repo');
  });

  it('logs "Opening <url>" to the console', async () => {
    process.chdir(os.tmpdir());
    const { consoleOut } = await runOpen(['open'], 'http://127.0.0.1:9999');
    expect(consoleOut).toContain('Opening');
  });
});
