import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { resolveHome } from 'diffwiki-core';
import { resolveAppLaunch } from './app';

export interface UiState {
  pid: number;
  port: number;
  url: string;
  startedAt: string;
}

/** A running UI: the persisted state plus the actual spawned child. */
export interface StartedUi {
  state: UiState;
  child: ChildProcess;
}

const DEFAULT_PORT = 4321;

function statePath(): string {
  return path.join(resolveHome(), 'ui.json');
}

export async function readState(): Promise<UiState | undefined> {
  try {
    return JSON.parse(await fs.readFile(statePath(), 'utf8')) as UiState;
  } catch {
    return undefined;
  }
}

async function writeState(state: UiState): Promise<void> {
  await fs.mkdir(resolveHome(), { recursive: true });
  await fs.writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function clearState(): Promise<void> {
  await fs.rm(statePath(), { force: true });
}

/** True if a process with `pid` is alive. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The platform command used to open a URL in the default browser. */
export function openCommand(): { cmd: string; args: (url: string) => string[] } {
  switch (platform()) {
    case 'darwin':
      return { cmd: 'open', args: (u) => [u] };
    case 'win32':
      return { cmd: 'cmd', args: (u) => ['/c', 'start', '', u] };
    default:
      return { cmd: 'xdg-open', args: (u) => [u] };
  }
}

export function openBrowser(url: string): void {
  const { cmd, args } = openCommand();
  spawn(cmd, args(url), { stdio: 'ignore', detached: true }).unref();
}

/** Poll the URL until it responds or the timeout elapses. */
export function waitForServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

/**
 * Resolve `true` once the child has exited. With `timeoutMs > 0`, resolve
 * `false` instead if it is still running after the timeout. Keying liveness off
 * the child's own exit state avoids the zombie TOCTOU of `process.kill(pid, 0)`,
 * which keeps reporting an unreaped (dead) child as alive.
 */
export function childExited(child: ChildProcess, timeoutMs = 0): Promise<boolean> {
  if (timeoutMs === 0) return Promise.resolve(child.exitCode !== null || child.signalCode !== null);
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

/**
 * Spawn the UI via `resolveAppLaunch()` in a detached process group so `down`
 * can stop it and its children. The published fallback runs the app PINNED to
 * the CLI's own version (`npx -y diffwiki-app@<version>`) — never `@latest`.
 */
export async function startUi(port = DEFAULT_PORT): Promise<StartedUi> {
  const { cmd, args } = resolveAppLaunch();
  const child = spawn(cmd, [...args, '--port', String(port)], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    detached: true,
    stdio: 'ignore',
  });
  if (child.pid === undefined) {
    throw new Error('failed to spawn diffwiki-app');
  }
  child.on('close', () => {
    // Clear stale state if the process exits early (e.g. port conflict, npx failure).
    void clearState();
  });
  child.unref();
  const state: UiState = {
    pid: child.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
  };
  await writeState(state);
  return { state, child };
}

/** Stop the running UI (kills the detached process group where supported). */
export async function stopUi(): Promise<UiState | undefined> {
  const state = await readState();
  if (!state) return undefined;
  try {
    // Negative pid targets the process group (Unix, detached spawn). On Windows
    // process.kill kills just the pid; children are best-effort.
    if (platform() === 'win32') process.kill(state.pid);
    else process.kill(-state.pid);
  } catch {
    // already gone
  }
  await clearState();
  return state;
}
