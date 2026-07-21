import fs from 'node:fs/promises';
import path from 'node:path';
import { findCollection, listCollections } from './collections';
import { parseArticle } from './frontmatter';
import { CollectionNotFoundError } from './errors';
import type { CollectionEntry } from './types';

export interface QueryHit {
  collection: string;
  path: string;
  title: string;
  tags: string[];
}

/**
 * DUMMY search: case-insensitive substring match over title, filename, and tags.
 * Real QMD-based semantic search replaces this later.
 */
export async function query(term: string, collection?: string): Promise<QueryHit[]> {
  let targets: CollectionEntry[];
  if (collection) {
    const one = await findCollection(collection);
    if (!one) throw new CollectionNotFoundError(collection);
    targets = [one];
  } else {
    targets = await listCollections();
  }

  const needle = term.toLowerCase();
  const hits: QueryHit[] = [];
  for (const entry of targets) {
    let files: string[];
    try {
      files = await fs.readdir(entry.path);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/\.mdx?$/.test(file)) continue;
      const full = path.join(entry.path, file);
      const parsed = parseArticle(await fs.readFile(full, 'utf8'));
      const haystack = [parsed.title, file, ...parsed.tags].join(' ').toLowerCase();
      if (!needle || haystack.includes(needle)) {
        hits.push({ collection: entry.name, path: full, title: parsed.title, tags: parsed.tags });
      }
    }
  }
  return hits;
}
