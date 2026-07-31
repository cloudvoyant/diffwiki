import type { CollectionTree, TreeNode } from './types';

// Client-safe: types only. Keep this free of any value import from `diffwiki-core`
// (e.g. the `toTreeNodes` re-export in ./tree) — that would drag server code
// (child_process, …) into the browser bundle for every component that imports this.

export interface ResolvedPath {
  /** The collection whose name prefixes the pathname, or null if it isn't registered. */
  collection: CollectionTree['collection'] | null;
  /** The raw first path segment (collection name), even when unregistered. */
  collName: string;
  /** Ancestor→leaf chain of nodes matching the pathname; empty when nothing matched. */
  chain: TreeNode[];
}

/**
 * Resolve a pathname against the collection nav tree: the owning collection and
 * the ancestor→leaf chain of nodes leading to it. Shared by the breadcrumbs and
 * the page audience/status indicator so the tree walk lives in exactly one place.
 * Returns `null` for the root/empty pathname; `chain` is non-empty iff a node's
 * `path` matched exactly (its last element is that node).
 */
export function resolvePath(tree: CollectionTree[], pathname: string): ResolvedPath | null {
  if (!pathname || pathname === '/') return null;
  const collName = decodeURIComponent(pathname.split('/').filter(Boolean)[0] ?? '');
  const ct = tree.find((t) => t.collection.name === collName) ?? null;
  const chain: TreeNode[] = [];
  if (ct) {
    const walk = (nodes: TreeNode[]): boolean => {
      for (const node of nodes) {
        chain.push(node);
        if (node.path === pathname) return true;
        if (node.children && walk(node.children)) return true;
        chain.pop();
      }
      return false;
    };
    walk(ct.nodes);
  }
  return { collection: ct ? ct.collection : null, collName, chain };
}
