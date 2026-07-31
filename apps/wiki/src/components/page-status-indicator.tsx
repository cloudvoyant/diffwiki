import { useRouterState } from '@tanstack/react-router';
import { AudienceBadge } from '@/components/audience-badge';
import { DraftMark } from '@/components/draft-mark';
import { resolvePath } from '@/lib/resolve-path';
import type { Audience, CollectionTree, PublishStatus } from '@/lib/types';

interface Resolved {
  audience?: Audience;
  status?: PublishStatus;
}

/** Resolve the audience/status for a pathname from the collection nav tree. */
function resolve(tree: CollectionTree[], pathname: string): Resolved | null {
  const r = resolvePath(tree, pathname);
  if (!r || !r.collection) return null;
  // The matched node (chain's last element) wins; otherwise fall back to the
  // collection's own audience/status (e.g. a collection landing page).
  const node = r.chain.at(-1);
  return node
    ? { audience: node.audience, status: node.status }
    : { audience: r.collection.audience, status: r.collection.status };
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
