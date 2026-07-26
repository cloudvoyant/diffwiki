import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedProjectHome } from 'diffwiki-core';
import { openBrowser, waitForServer } from './ui-server';

export interface PreviewOptions {
  cwd: string;
  port: number;
}

/**
 * First free TCP port on `host` at or after `start`. Preview MUST bind a port no
 * one else owns: if it reused a busy port (e.g. a running `diffwiki up`), the
 * readiness probe would get a 200 from THAT server and open the browser onto the
 * wrong wiki while preview's own server failed to bind. Probing up front avoids it.
 */
export async function findFreePort(start: number, host = '127.0.0.1'): Promise<number> {
  const isFree = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, host);
    });
  for (let port = start; port < start + 100; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port available in ${start}..${start + 99}`);
}

/**
 * Resolve how to launch the UI. `DIFFWIKI_APP_CMD` overrides (used by tests);
 * else the local workspace server (`apps/wiki/bin/wiki-server.mjs`) when present;
 * else the published `diffwiki-app@latest` via npx. Mirrors exporter.ts.
 */
function launchCommand(): { cmd: string; prefix: string[] } {
  const override = process.env.DIFFWIKI_APP_CMD;
  if (override) {
    const [cmd, ...prefix] = override.split(' ');
    return { cmd, prefix };
  }
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/wiki/bin/wiki-server.mjs'),
    path.resolve(process.cwd(), 'apps/wiki/bin/wiki-server.mjs'),
  ];
  const local = candidates.find((p) => existsSync(p));
  return local ? { cmd: 'node', prefix: [local] } : { cmd: 'npx', prefix: ['-y', 'diffwiki-app@latest'] };
}

/**
 * Preview the site described by the repo's diffwiki.yaml. Foreground command:
 * runs until the UI process exits (Ctrl-C). Cleans up the temp home on exit.
 */
export async function runPreview(opts: PreviewOptions): Promise<void> {
  const root = path.resolve(opts.cwd);
  const { home, entries } = await seedProjectHome(root); // throws if no diffwiki.yaml / no collections

  const { cmd, prefix } = launchCommand();
  // Bind a FREE port — never blindly reuse the requested one. If it is busy (e.g. a
  // running `diffwiki up`), reusing it would point the browser at that other server.
  const port = await findFreePort(opts.port);
  const url = `http://127.0.0.1:${port}`;
  console.log(`Previewing ${entries.length} collection(s) from ${path.join(root, 'diffwiki.yaml')}`);
  if (port !== opts.port) console.log(`Port ${opts.port} is in use — using ${port} instead.`);
  console.log(`Starting UI at ${url} …  (Ctrl-C to stop)`);

  const child = spawn(cmd, [...prefix, '--port', String(port)], {
    env: {
      ...process.env,
      DIFFWIKI_HOME: home,
      DIFFWIKI_PROJECT_DIR: root,
      PORT: String(port),
      HOST: '127.0.0.1',
    },
    stdio: 'inherit',
    // Own process group so a terminal Ctrl-C doesn't double-signal the child (which
    // triggers its slow graceful-shutdown countdown). We drive shutdown ourselves.
    detached: true,
  });

  // Signal the whole child group (negative pid) so `npx`→node grandchildren die too.
  const signalTree = (sig: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    }
  };
  let forcing = false;
  const stop = (): void => {
    if (forcing) return signalTree('SIGKILL'); // second Ctrl-C → kill now
    forcing = true;
    signalTree('SIGTERM'); // ask nicely…
    setTimeout(() => signalTree('SIGKILL'), 1000).unref(); // …then force, no 5s hang
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const ready = await waitForServer(url);
  if (ready) openBrowser(url);

  await new Promise<void>((resolve) => {
    const finish = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      void fs.rm(home, { recursive: true, force: true });
      resolve();
    };
    child.on('close', finish);
    child.on('error', (err) => {
      console.error(`Failed to start preview: ${err.message}`);
      finish();
    });
  });
}
