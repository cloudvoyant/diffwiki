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

const REQUEST_TIMEOUT_MS = 30_000;
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

  const request = <T = unknown>(op: string, params: Record<string, unknown>): Promise<T> => {
    if (closed) return Promise.reject(new Error('plugin process is not running'));
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`plugin request "${op}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, op, params })}\n`);
    });
  };

  const handshake = await request<{
    name: string;
    kind: string;
    version?: string;
    capabilities: PluginCapabilities;
  }>('initialize', { protocol: 1, home: resolveHome() });

  if (handshake.kind !== 'search') {
    closed = true;
    child.kill();
    throw new Error(`plugin "${record.name}" reported kind "${handshake.kind}", expected "search"`);
  }

  const capabilities = handshake.capabilities;
  const name = handshake.name;

  const mapHits = (result: unknown, collections: CollectionEntry[]): QueryHit[] => {
    const hits = (result as { hits?: WireHit[] } | undefined)?.hits ?? [];
    return hits.map((h) => {
      const coll = collections.find((c) => c.name === h.collection);
      const abs = coll ? path.join(coll.path, h.relPath) : h.relPath;
      return {
        collection: h.collection,
        path: abs,
        title: h.title,
        tags: h.tags ?? [],
        snippet: h.snippet,
        score: h.score,
        docid: h.docid,
      };
    });
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
      const result = await request<{ ready?: boolean }>('setup', {
        collections: toWireCollections(collections),
        embed: opts?.embed,
        prefetchModels: opts?.prefetchModels,
      });
      return { ready: result?.ready === true };
    },
    async reindex(collections, opts) {
      const result = await request<{ indexed?: number }>('index', {
        collections: toWireCollections(collections),
        embed: opts?.embed,
      });
      return result?.indexed ?? 0;
    },
    async search(term, collections, opts) {
      const result = await request('search', {
        term,
        collections: toWireCollections(collections),
        collection: opts?.collection,
        type: opts?.type,
        limit: opts?.limit,
      });
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
