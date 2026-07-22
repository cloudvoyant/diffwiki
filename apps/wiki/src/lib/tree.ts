import type { ArticleNode } from 'diffwiki-core';
import type { TreeNode } from './types';

/**
 * Map core article nodes to UI nav nodes, assigning each its route path. Folders
 * (branches) are navigable too — they resolve to an index page (authored index,
 * else a generated listing).
 */
export function toTreeNodes(coll: string, nodes: ArticleNode[]): TreeNode[] {
  return nodes.map((n) =>
    n.children
      ? {
          name: n.name,
          title: n.title ?? n.name,
          path: n.slug ? `/${coll}/${n.slug}` : undefined,
          children: toTreeNodes(coll, n.children),
        }
      : { name: n.name, title: n.title ?? n.name, path: `/${coll}/${n.slug}` },
  );
}
