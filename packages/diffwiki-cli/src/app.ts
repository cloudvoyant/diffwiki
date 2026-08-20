import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from './version';

/**
 * How the CLI launches the wiki app (`diffwiki-app`). The app is never bundled
 * into the CLI; every `site preview` / `site export` / `ui` spawn resolves the
 * app through this single helper:
 *
 *   1. `DIFFWIKI_APP_CMD`  — an explicit full command (tests; fake scripts).
 *   2. `DIFFWIKI_APP_SPEC` — an explicit npx package spec (tests; a local
 *      tarball/dir, or a registry spec). Forces the npx path.
 *   3. The local workspace app in a checkout (dev: `apps/wiki/bin/…`).
 *   4. The PUBLISHED app PINNED to the CLI's own version via npx
 *      (`diffwiki-app@<version>`). CLI and app ship in lockstep
 *      (`set-version`), so a given CLI always runs the app release it was
 *      built with — never a floating `@latest`.
 */
export interface AppLaunch {
  cmd: string;
  args: string[];
  source: 'override' | 'spec' | 'local' | 'npx';
  spec: string;
}

/** The npx spec the CLI uses for the published app, pinned to its own version. */
export const APP_SPEC = `diffwiki-app@${version}`;

/** The workspace app's launch bin for a monorepo checkout, if present. */
function workspaceAppBin(localBin: string): string | undefined {
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/wiki/bin', localBin),
    path.resolve(process.cwd(), 'apps/wiki/bin', localBin),
  ];
  return candidates.find((p) => existsSync(p));
}

export interface ResolveAppOptions {
  /** Local workspace bin to prefer in a checkout (default `wiki-server.mjs`). */
  localBin?: string;
}

/** Resolve how to launch the wiki app. See the module doc for the order. */
export function resolveAppLaunch(opts: ResolveAppOptions = {}): AppLaunch {
  const localBin = opts.localBin ?? 'wiki-server.mjs';
  const override = process.env.DIFFWIKI_APP_CMD;
  if (override) {
    const [cmd, ...args] = override.split(' ');
    return { cmd, args, source: 'override', spec: override };
  }
  const spec = process.env.DIFFWIKI_APP_SPEC;
  if (spec) return { cmd: 'npx', args: ['-y', spec], source: 'spec', spec };
  const local = workspaceAppBin(localBin);
  if (local) return { cmd: 'node', args: [local], source: 'local', spec: local };
  return { cmd: 'npx', args: ['-y', APP_SPEC], source: 'npx', spec: APP_SPEC };
}
