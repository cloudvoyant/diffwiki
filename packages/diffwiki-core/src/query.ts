import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { listCollections } from './collections';
import { parseArticle } from './frontmatter';
import { readConfig } from './config';
import { CollectionNotFoundError } from './errors';
import { loadSearchProvider } from './plugins/loader';
import { listEnabledPlugins } from './plugins/registry';
import { NATIVE_ENGINE } from './types';
import type { CollectionEntry, QueryHit, QueryOptions } from './types';

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(full)));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Built-in JS-native search: case-insensitive substring match over an article's
 * title, its collection name, and its tags — across every registered collection's
 * ABSOLUTE registry path (so in-repo wikis outside ~/.diffwiki are searched too).
 * No `find`/OS shelling — cross-platform and dependency-free.
 */
export async function nativeSearch(
  term: string,
  collections: CollectionEntry[],
  collection?: string,
): Promise<QueryHit[]> {
  let targets = collections;
  if (collection) {
    const one = collections.find((c) => c.name === collection);
    if (!one) throw new CollectionNotFoundError(collection);
    targets = [one];
  }

  const needle = term.toLowerCase();
  const hits: QueryHit[] = [];
  for (const entry of targets) {
    for (const full of await collectMarkdownFiles(entry.path)) {
      // A single unreadable file or malformed frontmatter (e.g. an unquoted
      // colon in the title, which the strict YAML engine rejects) must never
      // fail the whole search — degrade that file to its filename and keep going.
      const fallbackTitle = path.basename(full).replace(/\.mdx?$/, '');
      let title = fallbackTitle;
      let tags: string[] = [];
      try {
        const parsed = parseArticle(await fs.readFile(full, 'utf8'));
        if (parsed.title) title = parsed.title;
        tags = parsed.tags;
      } catch {
        /* keep the filename fallback */
      }
      const haystack = [title, entry.name, ...tags].join(' ').toLowerCase();
      if (!needle || haystack.includes(needle)) {
        hits.push({ collection: entry.name, path: full, title, tags });
      }
    }
  }
  return hits;
}

/**
 * Resolve the engine name to use when the caller did not pass `opts.engine`:
 * `config.defaultSearch` (a "<plugin>[:<type>]" string; the `:type` suffix is
 * stripped) when it names an enabled search plugin, else the first enabled search
 * plugin, else the built-in native engine.
 */
async function resolveDefaultEngine(): Promise<string> {
  const config = await readConfig();
  const enabled = await listEnabledPlugins('search');
  const configured = config.defaultSearch?.split(':')[0];
  if (configured && enabled.some((p) => p.name === configured)) return configured;
  if (enabled.length > 0) return enabled[0].name;
  return NATIVE_ENGINE;
}

export async function query(term: string, opts?: QueryOptions): Promise<QueryHit[]> {
  const collections = await listCollections();
  const engine = opts?.engine ?? (await resolveDefaultEngine());
  if (engine === NATIVE_ENGINE) return nativeSearch(term, collections, opts?.collection);
  const provider = await loadSearchProvider(engine);
  if (!provider) return nativeSearch(term, collections, opts?.collection);
  try {
    return await provider.search(term, collections, opts);
  } catch {
    return nativeSearch(term, collections, opts?.collection);
  } finally {
    await provider.close();
  }
}
