import { Fragment } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Github, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { ThemePicker } from '@/components/theme-picker';
import { cn } from '@/lib/utils';
import type { CollectionTree, TreeNode } from '@/lib/types';

interface Crumb {
  label: string;
  /** Collection slug — set only on the (linkable) collection crumb. */
  coll?: string;
  /** Route path for an intermediate/leaf node, e.g. "/docs/guide/setup". */
  path?: string;
}

/** Resolve the breadcrumb trail for a pathname from the collection nav tree. */
function buildCrumbs(tree: CollectionTree[], pathname: string): Crumb[] {
  if (!pathname || pathname === '/') return [];
  const collName = decodeURIComponent(pathname.split('/').filter(Boolean)[0] ?? '');
  const ct = tree.find((t) => t.collection.name === collName);
  if (!ct) return [{ label: collName }];

  const chain: TreeNode[] = [];
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

  return [{ label: collName, coll: collName }, ...chain.map((n) => ({ label: n.title ?? n.name, path: n.path }))];
}

function Breadcrumbs({ tree }: { tree: CollectionTree[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = buildCrumbs(tree, pathname);
  if (crumbs.length === 0) return null;

  // The first crumb always carries the collection name; intermediate crumbs are
  // links whose splat is their route path minus the leading "/{coll}/".
  const collName = crumbs[0]?.coll ?? '';
  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground sm:flex"
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        // Collection crumb → splat "". Intermediate crumb with a path → the path
        // after the collection segment. Others render as plain text.
        // Strip the "/{coll}/" prefix by literal string ops — collName is
        // user-supplied and may contain regex metacharacters, so never build a
        // RegExp from it.
        const prefix = `/${collName}/`;
        const splat = c.coll
          ? ''
          : c.path
            ? c.path.startsWith(prefix)
              ? c.path.slice(prefix.length)
              : c.path.replace(/^\//, '')
            : undefined;
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

/**
 * Stateful sidebar toggle — shows a "close" icon when the sidebar is open and an
 * "open" icon when it's collapsed (mobile uses the sheet's open state).
 */
function SidebarToggle() {
  const { toggleSidebar, state, isMobile, openMobile } = useSidebar();
  const isOpen = isMobile ? openMobile : state === 'expanded';
  const Icon = isOpen ? PanelLeftClose : PanelLeftOpen;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      className="-ml-1 size-9 shrink-0 text-muted-foreground hover:text-foreground"
    >
      <Icon className="size-5" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
}

/**
 * TopNav — full-width sticky bar above the sidebar and content. Holds the
 * sidebar toggle and breadcrumbs on the left and theme + GitHub controls on the
 * right. (The middle will also host navigation tabs later.) Height is governed
 * by the --nav-h CSS custom property (3.5rem = h-14).
 */
export function TopNav({ tree }: { tree: CollectionTree[] }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex items-center gap-3 border-b bg-background px-4 sm:px-6',
        'h-[var(--nav-h)]',
      )}
    >
      <SidebarToggle />

      <Breadcrumbs tree={tree} />

      {/* Right-side controls */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemePicker />
        <ThemeToggle />

        <a
          href="https://github.com/cloudvoyant/diffwiki"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub repository"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Github className="h-[18px] w-[18px]" aria-hidden />
        </a>
      </div>
    </header>
  );
}
