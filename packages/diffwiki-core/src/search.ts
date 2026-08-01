import fs from 'node:fs/promises';
import path from 'node:path';
import { listArticleTree, collectionMeta } from './browse';
import { findCollection, listCollections } from './collections';
import { parseArticle } from './frontmatter';
import { tokenize, type SearchDoc } from './bm25';
import type { ArticleNode } from './types';

const isStatic = (): boolean => process.env.DIFFWIKI_STATIC === '1';

/** Read a leaf article's tags + body from frontmatter. Falls back gracefully. */
async function readArticleParts(collDir: string, slug: string): Promise<{ tags: string[]; body: string }> {
  for (const ext of ['.mdx', '.md']) {
    try {
      const parsed = parseArticle(await fs.readFile(path.join(collDir, `${slug}${ext}`), 'utf8'));
      return { tags: parsed.tags, body: parsed.body };
    } catch {
      /* try next extension */
    }
  }
  return { tags: [], body: '' };
}

async function flatten(coll: string, collDir: string, nodes: ArticleNode[], out: SearchDoc[]): Promise<void> {
  for (const n of nodes) {
    if (n.audience === 'system') continue;
    if (isStatic() && (n.audience === 'private' || n.status === 'draft')) continue;
    if (n.slug && !n.children) {
      // Leaf article — read its real tags + body and tokenize every ranked field.
      const title = n.title ?? n.name;
      const { tags, body } = await readArticleParts(collDir, n.slug);
      out.push({
        collection: coll,
        slug: n.slug,
        title,
        tags,
        fields: {
          title: tokenize(title),
          tags: tokenize(tags.join(' ')),
          collection: tokenize(coll),
          body: tokenize(body),
        },
      });
    }
    if (n.children) await flatten(coll, collDir, n.children, out);
  }
}

/**
 * Build the search index: one {@link SearchDoc} per article, carrying routing
 * metadata (collection/slug/title/tags) AND the pre-tokenized fields BM25 ranks.
 * The static exporter serialises this to `search-index.json`; the browser ranks it
 * with the shared `rankDocs` (same algorithm as the server's native search), so
 * keyword search works fully offline on the static site.
 */
export async function buildSearchIndex(collection?: string): Promise<SearchDoc[]> {
  const entries = collection ? (await listCollections()).filter((c) => c.name === collection) : await listCollections();
  const out: SearchDoc[] = [];
  for (const e of entries) {
    try {
      const collEntry = await findCollection(e.name);
      const collDir = path.resolve(collEntry?.path ?? e.path);
      if (collEntry?.audience === 'system') continue; // system collections never enter the static index
      // Static export skips whole private/draft collections (marked via their index page).
      if (isStatic()) {
        const cm = await collectionMeta(collDir);
        if (cm.audience === 'private' || cm.status === 'draft') continue;
      }
      await flatten(e.name, collDir, await listArticleTree(e.name), out);
    } catch {
      // Skip collections whose content dir is missing/unreadable.
    }
  }
  return out;
}
