import { Fragment } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolvePath } from '@/lib/resolve-path';
import type { CollectionTree } from '@/lib/types';

interface Crumb {
  label: string;
  /** Collection slug — set only on the (linkable) collection crumb. */
  coll?: string;
  /** Route path for an intermediate/leaf node, e.g. "/docs/guide/setup". */
  path?: string;
}

/** Resolve the breadcrumb trail for a pathname from the collection nav tree. */
function buildCrumbs(tree: CollectionTree[], pathname: string): Crumb[] {
  const r = resolvePath(tree, pathname);
  if (!r) return [];
  if (!r.collection) return [{ label: r.collName }];
  const collLabel = r.collection.title ?? r.collName;
  return [{ label: collLabel, coll: r.collName }, ...r.chain.map((n) => ({ label: n.title ?? n.name, path: n.path }))];
}

/**
 * The `_splat` for a crumb's route link — its path minus the leading "/{coll}/".
 * The collection crumb → "". A crumb without a path is not a link → undefined.
 * Stripped with literal string ops (never a RegExp): collName is user-supplied
 * and may contain regex metacharacters.
 */
function crumbSplat(c: Crumb, prefix: string): string | undefined {
  if (c.coll) return '';
  if (!c.path) return undefined;
  return c.path.startsWith(prefix) ? c.path.slice(prefix.length) : c.path.replace(/^\//, '');
}

/**
 * Breadcrumb trail for the current route, resolved from the collection nav tree.
 *
 * The first crumb always carries the collection name; intermediate crumbs are
 * links whose splat is their route path minus the leading "/{coll}/".
 */
export function Breadcrumbs({ tree }: { tree: CollectionTree[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = buildCrumbs(tree, pathname);
  if (crumbs.length === 0) return null;

  const collName = crumbs[0]?.coll ?? '';
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const splat = crumbSplat(c, `/${collName}/`);
        const isLink = !isLast && splat !== undefined;
        return (
          <Fragment key={`${i}-${c.label}`}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-50" aria-hidden />}
            {isLink ? (
              <Link
                to="/$coll/$"
                params={{ coll: collName, _splat: splat }}
                className="shrink-0 whitespace-nowrap transition-colors hover:text-foreground"
              >
                {c.label}
              </Link>
            ) : (
              <span
                className={cn('truncate whitespace-nowrap', isLast && 'font-medium text-foreground')}
                aria-current={isLast ? 'page' : undefined}
              >
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
