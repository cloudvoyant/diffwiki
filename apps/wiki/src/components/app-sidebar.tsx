import { useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader } from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SettingsDialog } from '@/components/settings-dialog';
import { SidebarSearchButton } from '@/components/sidebar-search-button';
import { Logo } from '@/components/logo';
import { NavTree } from './nav-tree';
import type { CollectionTree, SiteConfig, TreeNode } from '../lib/types';

/** Solid GitHub mark (the filled Octocat) — theme-aware via currentColor. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/** The diffwiki logo + wordmark home link. Fixed branding — this is a wiki, not a custom site. */
function HomeLink() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-1.5 px-1 font-semibold text-foreground transition-colors hover:text-foreground/80"
      aria-label="diffwiki home"
    >
      <Logo className="size-6 shrink-0" />
      <span className="text-lg font-bold tracking-tight">diffwiki</span>
    </Link>
  );
}

/**
 * Left sidebar — primary navigation. Header: logo/wordmark home link + a search
 * button. Content: the collection nav tree. Footer: settings + GitHub.
 *
 * Each collection is a single collapsible menu item (not a section); its
 * articles nest underneath it to any depth. Everything starts collapsed. On
 * desktop the sidebar is a fixed, full-height rail; on mobile it overlays as a
 * sheet (handled by the shadcn Sidebar primitive).
 */
export function AppSidebar({ tree, site }: { tree: CollectionTree[]; site?: SiteConfig }) {
  const navigate = useNavigate();

  // Global ⌘K / Ctrl+K → navigate to the search page (the sidebar search button
  // does the same on click). The SidebarProvider binds ⌘B / Ctrl+B for toggling,
  // so there is no shortcut collision.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Already on /search: don't re-navigate — that would wipe an in-progress
        // query/filters. Focus the on-page search input instead (no-op if absent).
        if (window.location.pathname.startsWith('/search')) {
          document.querySelector<HTMLInputElement>('input[type="search"][name="q"]')?.focus();
          return;
        }
        void navigate({ to: '/search', search: { q: '', c: undefined, engine: undefined, type: undefined } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // "(repo)" disambiguates in-repo collections from global/external ones — only
  // meaningful when the tree actually mixes types. In a single-project view
  // (preview/publish, where every collection is type 'repo') it is just noise.
  const mixedTypes = tree.some((ct) => ct.collection.type !== 'repo');
  const nodes: TreeNode[] = tree.map((ct) => {
    const label = ct.collection.title ?? ct.collection.name;
    return {
      name: ct.collection.name,
      title: mixedTypes && ct.collection.type === 'repo' ? `${label} (repo)` : label,
      path: `/${ct.collection.name}`,
      audience: ct.collection.audience,
      status: ct.collection.status,
      children: ct.nodes,
      meta: ct.collection.branch ? { branch: ct.collection.branch, behind: ct.collection.behind } : undefined,
    };
  });

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 border-b px-2 py-3">
        <HomeLink />
        <SidebarSearchButton />
      </SidebarHeader>

      <SidebarContent>
        <ScrollArea className="h-full">
          <SidebarGroup className="p-0">
            {nodes.length > 0 ? (
              <NavTree nodes={nodes} />
            ) : (
              <div className="px-4 py-6 text-xs text-muted-foreground">No collections found.</div>
            )}
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="flex-row items-center gap-1 border-t px-2 py-2">
        <SettingsDialog />
        <a
          href={site?.repo ?? 'https://github.com/cloudvoyant/diffwiki'}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Project repository"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <GithubMark className="h-[18px] w-[18px]" />
        </a>
      </SidebarFooter>
    </Sidebar>
  );
}
