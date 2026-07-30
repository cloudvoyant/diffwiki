import { useRouterState } from '@tanstack/react-router';
import { AudienceBadge } from '@/components/audience-badge';
import { DraftMark } from '@/components/draft-mark';
import type { Audience, CollectionTree, PublishStatus, TreeNode } from '@/lib/types';

interface Resolved {
  audience?: Audience;
  status?: PublishStatus;
}

/** Resolve the audience/status for a pathname from the collection nav tree. */
function resolve(tree: CollectionTree[], pathname: string): Resolved | null {
  if (!pathname || pathname === '/') return null;
  const collName = decodeURIComponent(pathname.split('/').filter(Boolean)[0] ?? '');
  const ct = tree.find((t) => t.collection.name === collName);
  if (!ct) return null;

  let found: Resolved | null = null;
  const walk = (nodes: TreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.path === pathname) {
        found = { audience: node.audience, status: node.status };
        return true;
      }
      if (node.children && walk(node.children)) return true;
    }
    return false;
  };
  walk(ct.nodes);

  // Fall back to the collection's own audience/status (e.g. a collection landing
  // page) when no article node matches the exact path.
  return found ?? { audience: ct.collection.audience, status: ct.collection.status };
}

/**
 * Top-bar (far-right) indicator for the current page: a DRAFT mark when the
 * matched nav node is a draft, otherwise a Public/Private audience badge.
 * Renders nothing on routes with no matching collection node (home, search).
 */
export function PageStatusIndicator({ tree }: { tree: CollectionTree[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const resolved = resolve(tree, pathname);
  if (!resolved) return null;
  return resolved.status === 'draft' ? (
    <DraftMark className="shrink-0" />
  ) : (
    <AudienceBadge audience={resolved.audience} className="shrink-0" />
  );
}
