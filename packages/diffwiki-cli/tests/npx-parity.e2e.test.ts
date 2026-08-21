import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_SPEC, resolveAppLaunch } from '../src/app';
import { findFreePort } from '../src/preview';
import { waitForServer } from '../src/ui-server';
import { version } from '../src/version';

const exec = promisify(execFile);
const g = (cwd: string, args: string[]) => exec('git', args, { cwd });

/** The packaged CLI bin — the exact artifact `npx diffwiki …` runs. */
const cliBin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const built = existsSync(cliBin);

interface CliRun {
  ok: boolean;
  out: string;
  err: string;
}

/** Run the PACKAGED CLI bin as a subprocess — exactly how `npx diffwiki …` runs it. */
async function runCli(
  cwd: string,
  home: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 60_000,
): Promise<CliRun> {
  try {
    const { stdout, stderr } = await exec('node', [cliBin, ...args], {
      cwd,
      env: { ...process.env, DIFFWIKI_HOME: home, ...extraEnv },
      timeout: timeoutMs,
    });
    return { ok: true, out: stdout, err: stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { ok: false, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

/** A fresh home that does NOT exist yet — like a brand-new ~/.diffwiki. */
async function freshHome(): Promise<string> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-npx-home-'));
  createdParents.push(parent);
  return path.join(parent, 'home');
}

/**
 * Whether the pinned `diffwiki-app@<version>` resolves on the registry (offline →
 * skip serve parity). Probed SYNCHRONOUSLY at module scope because `it.runIf`
 * evaluates its condition at collection time — a `beforeAll` value would be too
 * late and the serve tests would always be skipped. The probe only runs when the
 * packaged bin is built: the serve describe below is `skipIf(!built)`, so on a
 * plain dev machine (no dist/) it never pays the network cost, and the
 * `resolveAppLaunch` unit describe doesn't pay it either.
 */
let appAvailable = false;
if (process.env.DIFFWIKI_APP_SPEC) {
  appAvailable = true;
} else if (built) {
  try {
    execFileSync('npm', ['view', `diffwiki-app@${version}`, 'version'], { stdio: 'pipe', timeout: 15_000 });
    appAvailable = true;
  } catch {
    appAvailable = false;
  }
}

let createdParents: string[] = [];
let uiHomes: string[] = [];

afterEach(async () => {
  for (const h of uiHomes) {
    await runCli(h, h, ['ui', 'down']).catch(() => undefined);
  }
  uiHomes = [];
  for (const p of createdParents) {
    await fs.rm(p, { recursive: true, force: true }).catch(() => undefined);
  }
  createdParents = [];
});

describe('resolveAppLaunch (pinned app spec)', () => {
  it('pins the app spec to the CLI version — never @latest', () => {
    expect(APP_SPEC).toBe(`diffwiki-app@${version}`);
    expect(APP_SPEC).not.toContain('@latest');
  });

  it('honors DIFFWIKI_APP_CMD over the pin', () => {
    process.env.DIFFWIKI_APP_CMD = 'node fake-app.mjs';
    try {
      const launch = resolveAppLaunch();
      expect(launch.source).toBe('override');
      expect(launch.cmd).toBe('node');
      expect(launch.args).toEqual(['fake-app.mjs']);
    } finally {
      delete process.env.DIFFWIKI_APP_CMD;
    }
  });

  it('forces the npx path when DIFFWIKI_APP_SPEC is set', () => {
    process.env.DIFFWIKI_APP_SPEC = 'diffwiki-app@9.9.9';
    try {
      const launch = resolveAppLaunch();
      expect(launch.source).toBe('spec');
      expect(launch.cmd).toBe('npx');
      expect(launch.args).toEqual(['-y', 'diffwiki-app@9.9.9']);
    } finally {
      delete process.env.DIFFWIKI_APP_SPEC;
    }
  });
});

describe.skipIf(!built)('first-command home init (packaged bin, npx parity)', () => {
  it('collection add on a fresh machine initializes ~/.diffwiki (registry, config, dirs)', async () => {
    const home = await freshHome();
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-npx-add-'));
    createdParents.push(repo);
    await g(repo, ['init']);
    await g(repo, ['config', 'user.email', 't@t.dev']);
    await g(repo, ['config', 'user.name', 'T']);
    await g(repo, ['commit', '--allow-empty', '-m', 'init']);

    const res = await runCli(repo, home, ['collection', 'add']);
    expect(res.ok, res.err).toBe(true);
    expect(res.out).toContain('Added');

    expect(existsSync(path.join(home, 'registry.json')), 'registry.json seeded').toBe(true);
    expect(existsSync(path.join(home, 'config.json')), 'config.json seeded').toBe(true);
    expect(existsSync(path.join(home, 'collections')), 'collections/ created').toBe(true);
    expect(existsSync(path.join(home, 'plugins')), 'plugins/ created').toBe(true);
    expect(existsSync(path.join(home, 'templates')), 'templates/ created').toBe(true);

    const registry = JSON.parse(await fs.readFile(path.join(home, 'registry.json'), 'utf8'));
    expect(registry.collections).toHaveLength(1);

    const list = await runCli(repo, home, ['collection', 'list']);
    expect(list.ok, list.err).toBe(true);
    expect(list.out).toContain('[external]');
  }, 30_000);
});

describe.skipIf(!built)('npx serve parity (packaged bin → real npx → pinned diffwiki-app)', () => {
  it.runIf(appAvailable)(
    'ui up boots the app through the pinned npx spec, serves, and ui down stops it',
    async () => {
      const home = await freshHome();
      await fs.mkdir(home, { recursive: true });
      uiHomes.push(home);
      const port = await findFreePort(4591);

      const up = await runCli(
        home,
        home,
        ['ui', 'up', '--port', String(port)],
        { DIFFWIKI_APP_SPEC: APP_SPEC },
        180_000,
      );
      expect(up.ok, up.err).toBe(true);

      const statePath = path.join(home, 'ui.json');
      expect(existsSync(statePath), 'ui.json written by ui up').toBe(true);
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      expect(state.url).toBe(`http://127.0.0.1:${port}`);
      expect(await waitForServer(state.url, 120_000), 'pinned app responds via npx').toBe(true);

      const status = await runCli(home, home, ['ui', 'status']);
      expect(status.ok, status.err).toBe(true);
      expect(status.out).toContain('running');

      const down = await runCli(home, home, ['ui', 'down']);
      expect(down.ok, down.err).toBe(true);
      expect(down.out).toMatch(/Stopped UI/);
      expect(await waitForServer(state.url, 5_000), 'app stopped after ui down').toBe(false);
      expect(existsSync(statePath), 'ui.json cleared by ui down').toBe(false);
    },
    180_000,
  );

  it.runIf(appAvailable)(
    'site preview serves the repo wiki via npx and tears the tree down on SIGTERM',
    async () => {
      const home = await freshHome();
      const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-npx-prev-'));
      createdParents.push(repo);
      await fs.mkdir(path.join(repo, 'wiki', 'guide'), { recursive: true });
      await fs.writeFile(path.join(repo, 'wiki', 'guide', 'index.md'), '# Guide\n\nBody.\n', 'utf8');
      await fs.writeFile(
        path.join(repo, 'diffwiki.yaml'),
        ['collections:', '  - name: guide', '    path: wiki/guide'].join('\n'),
        'utf8',
      );

      const port = await findFreePort(4601);
      const child = spawn('node', [cliBin, 'site', 'preview', '--port', String(port)], {
        cwd: repo,
        env: { ...process.env, DIFFWIKI_HOME: home, DIFFWIKI_APP_SPEC: APP_SPEC },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        expect(await waitForServer(`http://127.0.0.1:${port}`, 120_000), 'preview serves via npx').toBe(true);
      } finally {
        child.kill('SIGTERM');
        await Promise.race([
          new Promise<void>((r) => child.once('close', () => r())),
          new Promise<void>((r) => setTimeout(r, 15_000)),
        ]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
    180_000,
  );
});

describe.skipIf(!built)('ui up port conflict (packaged bin)', () => {
  it('fails with a non-zero exit when another process owns the port and clears ui.json', async () => {
    const home = await freshHome();
    await fs.mkdir(home, { recursive: true });
    uiHomes.push(home);
    const port = await findFreePort(4591);
    const app = fileURLToPath(new URL('./fixtures/fake-app.mjs', import.meta.url));

    // A dummy HTTP server occupies the port — a stand-in for a foreign/stale
    // process that already owns it and answers the readiness probe.
    const dummy = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('occupied');
    });
    await new Promise<void>((resolve) => dummy.listen(port, '127.0.0.1', resolve));

    try {
      const up = await runCli(home, home, ['ui', 'up', '--port', String(port)], {
        DIFFWIKI_APP_CMD: `node ${app}`,
      });
      expect(up.ok, up.err).toBe(false);
      expect(up.err).toContain('already in use');

      const statePath = path.join(home, 'ui.json');
      expect(existsSync(statePath), 'ui.json cleared after failed ui up').toBe(false);
    } finally {
      dummy.closeAllConnections?.();
      await new Promise<void>((resolve) => dummy.close(() => resolve()));
    }
  }, 60_000);
});
