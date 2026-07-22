import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { listCollections } from 'diffwiki-core';

export interface ArticleChange {
  coll: string;
  slug: string;
  type: 'add' | 'change' | 'unlink';
}

type Listener = (c: ArticleChange) => void;

// Server-side singleton: one watcher, many SSE subscribers.
let watcher: FSWatcher | undefined;
let starting: Promise<void> | undefined;
const listeners = new Set<Listener>();
const debounce = new Map<string, ReturnType<typeof setTimeout>>();
let dirs: { name: string; dir: string }[] = [];

async function ensureWatching(): Promise<void> {
  // NOTE: collections added via `diffwiki create` while the UI is running are not
  // picked up automatically — a restart is needed to watch newly-created collections.
  if (watcher) return;
  if (starting) return starting;
  starting = (async () => {
    const entries = await listCollections();
    dirs = entries.map((e) => ({ name: e.name, dir: path.resolve(e.path) }));
    watcher = chokidar.watch(
      dirs.map((d) => d.dir),
      { ignoreInitial: true, depth: 99 },
    );
    const emit = (type: ArticleChange['type']) => (file: string) => {
      if (!/\.(mdx?)$/.test(file)) return;
      const abs = path.resolve(file);
      const match = dirs.find((d) => abs === d.dir || abs.startsWith(d.dir + path.sep));
      if (!match) return;
      const rel = path.relative(match.dir, abs).replace(/\\/g, '/');
      const slug = rel.replace(/\.(mdx?)$/, '');
      const key = `${match.name}:${slug}:${type}`;
      clearTimeout(debounce.get(key));
      debounce.set(
        key,
        setTimeout(() => {
          debounce.delete(key);
          const change: ArticleChange = { coll: match.name, slug, type };
          for (const l of listeners) l(change);
        }, 120),
      );
    };
    watcher
      .on('add', emit('add'))
      .on('change', emit('change'))
      .on('unlink', emit('unlink'))
      .on('error', () => {
        /* swallow chokidar errors, don't crash */
      });
  })();
  return starting;
}

/** Subscribe to article changes. Returns an unsubscribe fn. Starts the watcher lazily. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  void ensureWatching();
  return () => {
    listeners.delete(listener);
  };
}
