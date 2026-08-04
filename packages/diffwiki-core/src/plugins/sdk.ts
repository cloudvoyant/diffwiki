/**
 * diffwiki plugin authoring SDK — the public surface for plugin authors, imported
 * via the `diffwiki-core/plugin` subpath export. Self-contained by design: it does
 * NOT import host-side code (fs registry, spawn-host, query) so plugin binaries
 * stay slim.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  DefinedPlugin,
  EventParams,
  HealthParams,
  IndexParams,
  PluginDefinition,
  PluginDependency,
  PluginLogFn,
  ResolvedDependency,
  RunProcessOptions,
  SearchParams,
  SetupParams,
} from './types';

export type * from './types';

// Frontmatter parsing is a core content concern. Expose the canonical parser and
// a line-preserving stripper so plugins that index article bodies (e.g.
// diffwiki-qmd) reuse them instead of re-implementing frontmatter detection —
// keeping the frontmatter format knowledge in one place.
export { parseArticle, stripFrontmatter, type ParsedArticle } from '../frontmatter';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Wire protocol types (internal to the SDK)
// ---------------------------------------------------------------------------

interface WireRequest {
  op: string;
  params?: Record<string, unknown>;
}

interface WireResponseOk {
  ok: true;
  result: unknown;
}

interface WireResponseErr {
  ok: false;
  error: { message: string };
}

// ---------------------------------------------------------------------------
// Subprocess utilities
// ---------------------------------------------------------------------------

/**
 * Run an external command and return its stdout/stderr — a promisified
 * `child_process.execFile` with uniform env/timeout defaults. Plugins driving
 * external CLIs (`qmd`, `rg`) use this instead of their own exec wrappers.
 */
export async function runProcess(
  file: string,
  args: readonly string[],
  opts?: RunProcessOptions,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(file, args as string[], {
    env: opts?.env,
    timeout: opts?.timeout,
    // Large: qmd emits multi-MB JSON search payloads that overflow the default 1 MB.
    maxBuffer: 50 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** Run an external command and JSON-parse its stdout. Throws if the output is not valid JSON. */
export async function runProcessJson<T>(file: string, args: readonly string[], opts?: RunProcessOptions): Promise<T> {
  const { stdout } = await runProcess(file, args, opts);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${file} ${args.join(' ')} did not return valid JSON: ${stdout.slice(0, 200)}`);
  }
}

/** Return `true` if `<name> --version` exits successfully. Never throws. */
export async function commandExists(name: string): Promise<boolean> {
  try {
    await execFileAsync(name, ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an npm package's binary to an absolute path, anchored at `fromUrl`.
 *
 * Walks the `node_modules` chain upward from `fromUrl` to find
 * `<ancestor>/node_modules/<pkg>/package.json`, then joins its `bin` entry for
 * `command`. Deliberately avoids `require.resolve('<pkg>/package.json')`: packages
 * with an `exports` map (like `@tobilu/qmd`) block that subpath. Returns null if
 * not found. Never throws.
 */
function resolveNpmBin(pkg: string, command: string, fromUrl: string): string | null {
  try {
    let dir = dirname(fileURLToPath(fromUrl));
    for (;;) {
      const pkgJson = join(dir, 'node_modules', pkg, 'package.json');
      if (existsSync(pkgJson)) {
        const raw = JSON.parse(readFileSync(pkgJson, 'utf8')) as { bin?: string | Record<string, string> };
        const rel = typeof raw.bin === 'string' ? raw.bin : raw.bin?.[command];
        if (!rel) return null;
        const binPath = join(dirname(pkgJson), rel);
        return existsSync(binPath) ? binPath : null;
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

/**
 * Resolve a declared {@link PluginDependency} to an argv prefix. Prefers the
 * npm-provided local bin (when `dep.npm` is set, looked up relative to `fromUrl`),
 * then falls back to the bare command on PATH. Returns
 * `{ command: null, source: 'missing' }` when neither resolves. Never throws.
 *
 * @param dep     The dependency to resolve.
 * @param fromUrl The plugin bin's `import.meta.url`, used to anchor node resolution.
 */
export async function resolveDependency(dep: PluginDependency, fromUrl: string): Promise<ResolvedDependency> {
  if (dep.npm) {
    const local = resolveNpmBin(dep.npm, dep.command, fromUrl);
    if (local) return { dependency: dep, command: [local], source: 'npm' };
  }
  if (await commandExists(dep.command)) {
    return { dependency: dep, command: [dep.command], source: 'path' };
  }
  return { dependency: dep, command: null, source: 'missing' };
}

// ---------------------------------------------------------------------------
// ensureTool — best-effort auto-install of a system dependency
// ---------------------------------------------------------------------------

/** Per-package-manager identifiers for a tool ensureTool can install. */
export interface ToolInstallers {
  /** mise tool id (installed with `mise use -g`), e.g. `'fzf'` or `'npm:@tobilu/qmd'`. */
  mise?: string;
  /** Homebrew formula (installed with `brew install`), e.g. `'fzf'`. */
  brew?: string;
  /** apt package name. NOT auto-run (needs sudo) — surfaced as guidance only. */
  apt?: string;
}

/** A tool to ensure is on PATH, with the package ids + a manual fallback hint. */
export interface EnsureToolSpec extends ToolInstallers {
  /** Executable checked on PATH, e.g. `'fzf'`. */
  command: string;
  /** Manual instruction (URL or command) shown when auto-install can't proceed. */
  manual: string;
}

/** The outcome of an {@link ensureTool} call. */
export interface EnsureToolResult {
  command: string;
  /** True if the tool is on PATH after ensureTool ran. */
  present: boolean;
  /** True if ensureTool installed it during this call. */
  installed: boolean;
  /** The manager used, when an install was attempted and succeeded. */
  method?: 'mise' | 'brew';
  /** A human-facing message describing the outcome. */
  message: string;
}

/** Injectable seams for {@link ensureTool} (defaults hit the real system). */
export interface EnsureToolOptions {
  /** Attempt installation when the tool is missing (default: false — check only). */
  install?: boolean;
  /** Diagnostic sink. */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Existence probe (injected in tests). Defaults to {@link commandExists}. */
  exists?: (command: string) => Promise<boolean>;
  /** Command runner (injected in tests). Defaults to {@link runProcess}. */
  run?: (file: string, args: readonly string[]) => Promise<unknown>;
}

/**
 * Ensure a system tool is on PATH, optionally installing it via a detected
 * package manager. Detection order: **mise**, then **Homebrew**. `apt` is
 * intentionally never auto-run (it needs `sudo`, which would hang or prompt) —
 * it is included in the guidance message instead. Safe to call when the tool
 * already exists (returns immediately) and never throws.
 *
 * Note: a tool installed via mise may not be on PATH in the current process
 * until mise's shims are active; that case is reported as `installed:true,
 * present:false` with a message telling the user to restart their shell.
 */
export async function ensureTool(spec: EnsureToolSpec, opts?: EnsureToolOptions): Promise<EnsureToolResult> {
  const exists = opts?.exists ?? commandExists;
  const run = opts?.run ?? ((file, args) => runProcess(file, args));
  const log = opts?.log;

  if (await exists(spec.command)) {
    return { command: spec.command, present: true, installed: false, message: `${spec.command} present` };
  }
  if (!opts?.install) {
    return {
      command: spec.command,
      present: false,
      installed: false,
      message: `${spec.command} not found — ${spec.manual}`,
    };
  }

  // Managers that don't require sudo, tried in order.
  const attempts: Array<{ method: 'mise' | 'brew'; bin: string; args: string[] }> = [];
  if (spec.mise && (await exists('mise')))
    attempts.push({ method: 'mise', bin: 'mise', args: ['use', '-g', spec.mise] });
  if (spec.brew && (await exists('brew'))) attempts.push({ method: 'brew', bin: 'brew', args: ['install', spec.brew] });

  for (const a of attempts) {
    try {
      log?.('info', `installing ${spec.command} via ${a.method}…`);
      await run(a.bin, a.args);
      if (await exists(spec.command)) {
        return {
          command: spec.command,
          present: true,
          installed: true,
          method: a.method,
          message: `installed ${spec.command} via ${a.method}`,
        };
      }
      return {
        command: spec.command,
        present: false,
        installed: true,
        method: a.method,
        message: `installed ${spec.command} via ${a.method}, but it isn't on PATH yet — restart your shell (or activate ${a.method}) and retry`,
      };
    } catch (err) {
      log?.('warn', `${a.method} could not install ${spec.command}: ${(err as Error).message}`);
    }
  }

  const aptHint = spec.apt ? ` (Debian/Ubuntu: sudo apt-get install -y ${spec.apt})` : '';
  return {
    command: spec.command,
    present: false,
    installed: false,
    message: `could not auto-install ${spec.command} — ${spec.manual}${aptHint}`,
  };
}

// ---------------------------------------------------------------------------
// definePlugin
// ---------------------------------------------------------------------------

/**
 * Define a diffwiki plugin. The required entry point for all plugins: accepts a
 * {@link PluginDefinition} and returns a {@link DefinedPlugin} whose `.run()`
 * serves one request over stdin/stdout then exits.
 *
 * @example
 * ```ts
 * import { definePlugin } from 'diffwiki-core/plugin';
 *
 * definePlugin({
 *   name: 'my-plugin',
 *   kind: 'search',
 *   capabilities: { searchTypes: ['text'], collectionFilter: true, events: false },
 *   handlers: { async search() { return { hits: [] }; } },
 * }).run();
 * ```
 */
export function definePlugin(def: PluginDefinition): DefinedPlugin {
  const { name, kind, version, capabilities, dependencies, handlers } = def;

  const describeResult = {
    name,
    kind,
    version,
    capabilities: {
      searchTypes: capabilities.searchTypes,
      collectionFilter: capabilities.collectionFilter,
      events: capabilities.events,
    },
    dependencies: (dependencies ?? []).map((d) => ({ command: d.command, npm: d.npm, hint: d.hint })),
  };

  async function dispatch(op: string, params: Record<string, unknown>, log: PluginLogFn): Promise<unknown> {
    switch (op) {
      case 'describe':
        return describeResult;

      case 'search':
        return handlers.search(params as unknown as SearchParams, log);

      case 'index':
        if (handlers.index) return handlers.index(params as unknown as IndexParams, log);
        return { indexed: 0 };

      case 'setup':
        if (handlers.setup) return handlers.setup(params as unknown as SetupParams, log);
        return { ready: true };

      case 'event':
        if (handlers.onEvent) return handlers.onEvent(params as unknown as EventParams, log);
        return { accepted: true };

      case 'health':
        if (handlers.health) return handlers.health(params as unknown as HealthParams, log);
        return { ready: true, diagnostics: [] };

      default:
        throw new Error(`unknown op: ${op}`);
    }
  }

  function run(): void {
    const log: PluginLogFn = (level, message) => {
      process.stderr.write(JSON.stringify({ log: { level, message } }) + '\n');
    };

    let buffer = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
    });

    process.stdin.on('end', () => {
      const line = buffer.trim();
      if (!line) {
        process.stderr.write(`${name}: no input received on stdin\n`);
        process.exit(1);
        return;
      }

      let req: WireRequest;
      try {
        req = JSON.parse(line) as WireRequest;
      } catch {
        process.stderr.write(`${name}: malformed JSON on stdin: ${line.slice(0, 200)}\n`);
        process.exit(1);
        return;
      }

      dispatch(req.op, req.params ?? {}, log)
        .then((result) => {
          const response: WireResponseOk = { ok: true, result };
          process.stdout.write(JSON.stringify(response) + '\n');
          process.exit(0);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const response: WireResponseErr = { ok: false, error: { message } };
          process.stdout.write(JSON.stringify(response) + '\n');
          process.exit(1);
        });
    });
  }

  return { definition: def, run };
}
