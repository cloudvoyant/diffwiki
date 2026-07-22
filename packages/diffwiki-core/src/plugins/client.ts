import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { resolveHome } from '../paths';
import type {
  CollectionEntry,
  PluginCapabilities,
  PluginEvent,
  PluginHealth,
  PluginReadiness,
  PluginRecord,
  QueryHit,
  SearchProvider,
} from '../types';

// Per-op timeouts. Most ops are quick, but `setup`/`index` can download a
// multi-hundred-MB embedding model and embed a whole corpus (minutes), and a
// semantic/hybrid `search` may trigger an incremental re-embed on a stale index.
const REQUEST_TIMEOUT_MS = 30_000; // initialize, notify, health
const SEARCH_TIMEOUT_MS = 120_000; // search (hybrid rerank / small re-embed)
const LONG_TIMEOUT_MS = 1_800_000; // setup, index — model download + full embed
const SHUTDOWN_GRACE_MS = 500;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WireCollection {
  name: string;
  path: string;
}

interface WireHit {
  collection: string;
  relPath: string;
  title: string;
  snippet?: string;
  score?: number;
  docid?: string;
  tags?: string[];
}

function toWireCollections(collections: CollectionEntry[]): WireCollection[] {
  return collections.map((c) => ({ name: c.name, path: c.path }));
}

export async function spawnPluginClient(record: PluginRecord): Promise<SearchProvider> {
  const child: ChildProcessWithoutNullStreams = spawn(record.command[0], record.command.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let buffer = '';
  let closed = false;

  const failAll = (err: Error): void => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  };

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // non-JSON noise on stdout — ignore
    }
    if (typeof msg !== 'object' || msg === null) return;
    const payload = msg as Record<string, unknown>;
    if ('log' in payload && !('id' in payload)) return; // diagnostic log line
    const id = payload.id;
    if (typeof id !== 'number') return;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (payload.ok === true) {
      p.resolve(payload.result);
    } else {
      const error = payload.error as { message?: unknown } | undefined;
      const message = typeof error?.message === 'string' ? error.message : 'plugin request failed';
      p.reject(new Error(message));
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  });

  child.on('error', (err: Error) => {
    closed = true;
    failAll(err);
  });
  child.on('exit', () => {
    closed = true;
    failAll(new Error('plugin process exited'));
  });

  const request = <T = unknown>(
    op: string,
    params: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> => {
    if (closed) return Promise.reject(new Error('plugin process is not running'));
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`plugin request "${op}" timed out`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, op, params })}\n`, (err) => {
        // A mid-flight write failure (e.g. EPIPE) must reject the pending request
        // promptly rather than let it hang until the 30s timeout.
        if (!err) return;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        clearTimeout(p.timer);
        p.reject(err);
      });
    });
  };

  // Any failure during handshake/validation must not leave a live child behind.
  let handshake: {
    name: string;
    kind: string;
    version?: string;
    capabilities: PluginCapabilities;
  };
  try {
    handshake = await request<{
      name: string;
      kind: string;
      version?: string;
      capabilities: PluginCapabilities;
    }>('initialize', { protocol: 1, home: resolveHome() });

    if (handshake.kind !== 'search') {
      throw new Error(`plugin "${record.name}" reported kind "${handshake.kind}", expected "search"`);
    }
  } catch (err) {
    closed = true;
    child.kill('SIGKILL');
    throw err;
  }

  const capabilities = handshake.capabilities;
  const name = handshake.name;

  const mapHits = (result: unknown, collections: CollectionEntry[]): QueryHit[] => {
    const raw = (result as { hits?: unknown } | undefined)?.hits;
    const hits = Array.isArray(raw) ? raw : [];
    const out: QueryHit[] = [];
    for (const item of hits) {
      if (typeof item !== 'object' || item === null) continue;
      const h = item as Partial<WireHit>;
      // Defensive wire parsing (mirror the adapters): skip entries whose required
      // string fields are not strings rather than trusting the cast.
      if (typeof h.collection !== 'string' || typeof h.relPath !== 'string') continue;
      const title = typeof h.title === 'string' ? h.title : h.relPath;
      const coll = collections.find((c) => c.name === h.collection);
      const abs = coll ? path.join(coll.path, h.relPath) : h.relPath;
      out.push({
        collection: h.collection,
        path: abs,
        title,
        tags: Array.isArray(h.tags) ? h.tags.filter((t): t is string => typeof t === 'string') : [],
        snippet: typeof h.snippet === 'string' ? h.snippet : undefined,
        score: typeof h.score === 'number' ? h.score : undefined,
        docid: typeof h.docid === 'string' ? h.docid : undefined,
      });
    }
    return out;
  };

  const close = async (): Promise<void> => {
    if (!closed) {
      try {
        await request('shutdown', {});
      } catch {
        // shutting down — ignore
      }
    }
    closed = true;
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, SHUTDOWN_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const provider: SearchProvider = {
    name,
    capabilities,
    async setup(collections, opts) {
      const result = await request<{ ready?: boolean }>(
        'setup',
        {
          collections: toWireCollections(collections),
          embed: opts?.embed,
          prefetchModels: opts?.prefetchModels,
        },
        LONG_TIMEOUT_MS,
      );
      return { ready: result?.ready === true };
    },
    async reindex(collections, opts) {
      const result = await request<{ indexed?: number }>(
        'index',
        {
          collections: toWireCollections(collections),
          embed: opts?.embed,
        },
        LONG_TIMEOUT_MS,
      );
      return result?.indexed ?? 0;
    },
    async search(term, collections, opts) {
      const result = await request(
        'search',
        {
          term,
          collections: toWireCollections(collections),
          collection: opts?.collection,
          type: opts?.type,
          limit: opts?.limit,
        },
        SEARCH_TIMEOUT_MS,
      );
      return mapHits(result, collections);
    },
    async notify(event: PluginEvent, collection, relPath, collections) {
      try {
        const entry = collections.find((c) => c.name === collection);
        await request('notify', {
          event,
          collection: entry ? { name: entry.name, path: entry.path } : { name: collection, path: '' },
          relPath,
          collections: toWireCollections(collections),
        });
      } catch {
        // hooks are best-effort — never surface into a mutation
      }
    },
    async health(collections): Promise<PluginHealth> {
      const result = await request<{
        ready?: boolean;
        readiness?: PluginReadiness;
        diagnostics?: PluginHealth['diagnostics'];
      }>('health', { collections: toWireCollections(collections) });
      return {
        ready: result?.ready === true,
        readiness: result?.readiness,
        diagnostics: result?.diagnostics ?? [],
      };
    },
    close,
  };

  return provider;
}
