import { createServerFn } from '@tanstack/react-start';
import {
  readArticle,
  listArticleTree,
  renderArticle,
  ArticleNotFoundError,
  CollectionNotFoundError,
  type ArticleNode,
} from 'diffwiki-core';
import type { ListingEntry, PageData } from '../lib/types';

/** Depth-first search for the branch node with a given slug. */
function findNode(nodes: ArticleNode[], slug: string): ArticleNode | undefined {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    if (n.children) {
      const found = findNode(n.children, slug);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Resolve a route to either a document (an article or an authored index) or a
 * generated directory listing (a folder/collection with no index file).
 *
 * Returns `null` when the route genuinely resolves to nothing (missing article,
 * unknown collection) — the route loader turns that into a 404. Real failures
 * (filesystem errors, render/highlight crashes) propagate so they surface as errors
 * rather than being masked as "not found".
 */
export const readPage = createServerFn({ method: 'GET' })
  .validator((d: { coll: string; slug: string }) => d)
  .handler(async ({ data }): Promise<PageData | null> => {
    const { coll, slug } = data;

    try {
      // Core resolves the file or a folder/collection index (+ traversal guard)
      // and renders the body to highlighted HTML (+ TOC).
      const art = await readArticle(coll, slug);
      const { html, toc } = await renderArticle(art.body);

      return {
        kind: 'doc',
        coll: art.coll,
        slug: art.slug,
        title: art.title,
        tags: art.tags,
        html,
        toc,
        path: `/${art.coll}/${art.slug}`,
      };
    } catch (err) {
      if (err instanceof CollectionNotFoundError) return null;
      // Only a missing document falls through to a listing; anything else is a
      // real error and must propagate.
      if (!(err instanceof ArticleNotFoundError)) throw err;

      let nodes: ArticleNode[];
      try {
        nodes = await listArticleTree(coll);
      } catch (e) {
        if (e instanceof CollectionNotFoundError) return null;
        throw e;
      }

      const folder = slug ? findNode(nodes, slug) : { title: undefined, children: nodes };
      if (!folder?.children) return null;

      const entries: ListingEntry[] = folder.children.map((n) => ({
        name: n.name,
        title: n.title ?? n.name,
        path: `/${coll}/${n.slug ?? n.name}`,
        isDir: Array.isArray(n.children),
      }));

      return {
        kind: 'listing',
        coll,
        slug,
        title: folder.title ?? (slug ? (slug.split('/').pop() ?? slug) : coll),
        entries,
      };
    }
  });
