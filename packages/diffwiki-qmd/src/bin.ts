import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, type HandlerMap, type LogFn } from './protocol.js';
import {
  execFileAsync,
  INDEX,
  modelsDir,
  qmdEnv,
  qmdOnPath,
  runQmd,
  runQmdJson,
  type Env,
  type ExecFileFn,
} from './qmd.js';

const VERSION = '0.3.0';

export interface Collection {
  name: string;
  path: string;
}

export interface QmdRow {
  file?: string;
  displayPath?: string;
  title?: string;
  bestChunk?: string;
  score?: number;
  docid?: string;
}

export interface QmdStatus {
  totalDocuments?: number;
  needsEmbedding?: number;
  hasVectorIndex?: boolean;
  collections?: unknown[];
}

export interface Hit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  score?: number;
  docid?: string;
}

export interface Deps {
  exec: ExecFileFn;
  /** Initial home; overridden by `initialize.params.home` when provided. */
  home?: string;
}

/** Derive collection + relPath from a qmd row's `file` (strip `qmd://`) or `displayPath`. */
export function splitQmdPath(row: QmdRow): { collection: string; relPath: string } {
  let raw = '';
  if (typeof row.file === 'string' && row.file.length > 0) {
    raw = row.file.replace(/^qmd:\/\//, '');
  } else if (typeof row.displayPath === 'string') {
    raw = row.displayPath;
  }
  raw = raw.replace(/^\/+/, '');
  const slash = raw.indexOf('/');
  if (slash === -1) return { collection: raw, relPath: '' };
  return { collection: raw.slice(0, slash), relPath: raw.slice(slash + 1) };
}

/** Map a diffwiki search type to the qmd subcommand. */
export function searchSubcommand(type: string | undefined): string {
  switch (type) {
    case 'semantic':
      return 'vsearch';
    case 'hybrid':
      return 'query';
    case 'keyword':
    default:
      return 'search';
  }
}

function isAlreadyExists(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists/i.test(msg);
}

function asCollections(params: Record<string, unknown>): Collection[] {
  const raw = params.collections;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is Collection =>
        !!c && typeof (c as Collection).name === 'string' && typeof (c as Collection).path === 'string',
    )
    .map((c) => ({ name: c.name, path: c.path }));
}

async function addCollections(exec: ExecFileFn, env: Env, collections: Collection[], log: LogFn): Promise<void> {
  for (const c of collections) {
    try {
      await runQmd(exec, ['collection', 'add', c.path, '--name', c.name, '--index', INDEX], env);
      log('info', `added collection ${c.name} (${c.path})`);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      log('info', `collection ${c.name} already present`);
    }
  }
}

/** Build the op handler map, closing over the injected exec and a mutable home. */
export function makeHandlers(deps: Deps): HandlerMap {
  let home = deps.home ?? join(homedir(), '.diffwiki');
  const exec = deps.exec;

  return {
    initialize(params) {
      if (typeof params.home === 'string' && params.home.length > 0) {
        home = params.home;
      }
      return {
        name: 'diffwiki-qmd',
        kind: 'search',
        version: VERSION,
        capabilities: {
          searchTypes: ['keyword', 'semantic', 'hybrid'],
          collectionFilter: true,
          hooks: true,
          setup: true,
        },
      };
    },

    async setup(params, log) {
      const env = qmdEnv(home);
      const steps: Array<{ step: string; ok: boolean; message?: string }> = [];
      const installed = await qmdOnPath(exec, env);
      if (!installed) {
        log('error', 'qmd not found on PATH — install with: npm i -g @tobilu/qmd');
        steps.push({ step: 'verify-qmd', ok: false, message: 'qmd not on PATH' });
        return { ready: false, steps };
      }
      steps.push({ step: 'verify-qmd', ok: true });

      const collections = asCollections(params);
      await addCollections(exec, env, collections, log);
      steps.push({
        step: 'add-collections',
        ok: true,
        message: `${collections.length} collection(s)`,
      });

      try {
        await runQmd(exec, ['update', '--index', INDEX], env);
        steps.push({ step: 'index', ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ step: 'index', ok: false, message });
      }

      if (params.embed === true || params.prefetchModels === true) {
        log('info', 'embedding index (may download models on first run)');
        try {
          await runQmd(exec, ['embed', '--index', INDEX], env);
          steps.push({ step: 'embed', ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          steps.push({ step: 'embed', ok: false, message });
        }
      }

      return { ready: true, steps };
    },

    async index(params, log) {
      const env = qmdEnv(home);
      const collections = asCollections(params);
      await addCollections(exec, env, collections, log);
      await runQmd(exec, ['update', '--index', INDEX], env);
      if (params.embed === true) {
        log('info', 'embedding index');
        await runQmd(exec, ['embed', '--index', INDEX], env);
      }
      return { indexed: collections.length };
    },

    async notify(params, log) {
      const env = qmdEnv(home);
      const collection = params.collection as Collection | undefined;
      if (collection && typeof collection.name === 'string') {
        try {
          await runQmd(exec, ['update', '--index', INDEX, '-c', collection.name], env);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('warn', `notify update failed for ${collection.name}: ${message}`);
        }
      }
      return { accepted: true };
    },

    async search(params) {
      const env = qmdEnv(home);
      const term = typeof params.term === 'string' ? params.term : '';
      const type = typeof params.type === 'string' ? params.type : 'keyword';
      const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 20;
      const sub = searchSubcommand(type);

      const args = [sub, term, '--index', INDEX, '--format', 'json', '-n', String(limit)];
      if (typeof params.collection === 'string' && params.collection.length > 0) {
        args.push('-c', params.collection);
      }

      const rows = await runQmdJson<QmdRow[]>(exec, args, env);
      const hits: Hit[] = (Array.isArray(rows) ? rows : []).map((row) => {
        const { collection, relPath } = splitQmdPath(row);
        return {
          collection,
          relPath,
          title: typeof row.title === 'string' ? row.title : relPath,
          snippet: row.bestChunk || undefined,
          score: typeof row.score === 'number' ? row.score : undefined,
          docid: typeof row.docid === 'string' ? row.docid : undefined,
        };
      });
      return { hits };
    },

    async health(params, log) {
      const env = qmdEnv(home);
      const diagnostics: Array<{ level: 'ok' | 'warn' | 'error'; message: string }> = [];
      const toolInstalled = await qmdOnPath(exec, env);
      if (!toolInstalled) {
        log('error', 'qmd not on PATH');
        diagnostics.push({
          level: 'error',
          message: 'qmd not installed — run: npm i -g @tobilu/qmd',
        });
        return {
          ready: false,
          readiness: {
            toolInstalled: false,
            modelsPresent: false,
            indexBuilt: false,
            docsIndexed: 0,
            embeddingsPending: 0,
            firstSearchCost: 'model-download' as const,
          },
          diagnostics,
        };
      }

      let modelsPresent = false;
      try {
        const dir = modelsDir(home);
        modelsPresent = existsSync(dir) && readdirSync(dir).length > 0;
      } catch {
        modelsPresent = false;
      }

      let status: QmdStatus = {};
      try {
        status = await runQmdJson<QmdStatus>(exec, ['status', '--index', INDEX, '--format', 'json'], env);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        diagnostics.push({ level: 'warn', message: `qmd status unavailable: ${message}` });
      }

      const docsIndexed = typeof status.totalDocuments === 'number' ? status.totalDocuments : 0;
      const embeddingsPending = typeof status.needsEmbedding === 'number' ? status.needsEmbedding : 0;
      const indexBuilt = docsIndexed > 0;

      // Keyword search is instant once the index is built (no model). Semantic/hybrid
      // pay a model load (cached) or a multi-GB download (first ever run) — surface that.
      // 'instant' overall once keyword is ready; else model-load if cached, model-download if not.
      const firstSearchCost: 'instant' | 'model-load' | 'model-download' = indexBuilt
        ? 'instant'
        : modelsPresent
          ? 'model-load'
          : 'model-download';

      diagnostics.push({
        level: 'ok',
        message: `qmd ready — ${docsIndexed} docs indexed, ${embeddingsPending} pending embeddings`,
      });
      if (!modelsPresent) {
        diagnostics.push({
          level: 'warn',
          message: 'semantic/hybrid search will download models (~2GB) on first use — run: diffwiki index --embed',
        });
      }

      return {
        ready: indexBuilt || toolInstalled,
        readiness: {
          toolInstalled,
          modelsPresent,
          indexBuilt,
          docsIndexed,
          embeddingsPending,
          firstSearchCost,
        },
        diagnostics,
      };
    },

    shutdown() {
      return {};
    },
  };
}

const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  serve(makeHandlers({ exec: execFileAsync }))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      process.stderr.write(`diffwiki-qmd: fatal: ${String(err)}\n`);
      process.exit(1);
    });
}
