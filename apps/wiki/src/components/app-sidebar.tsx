import { Link } from '@tanstack/react-router';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader } from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchBox } from './search-box';
import { Logo } from './logo';
import { NavTree } from './nav-tree';
import type { CollectionTree, TreeNode } from '../lib/types';

/**
 * Left sidebar (below the top bar): a sticky header (logo + search) over the
 * collection nav.
 *
 * Each collection is a single collapsible menu item (not a section); its
 * articles nest underneath it to any depth. Everything starts collapsed. On
 * desktop the sidebar is a fixed, full-height rail; on mobile it overlays as a
 * sheet (handled by the shadcn Sidebar primitive).
 */
export function AppSidebar({ tree }: { tree: CollectionTree[] }) {
  const nodes: TreeNode[] = tree.map((ct) => ({
    name: ct.collection.name,
    title: ct.collection.type === 'repo' ? `${ct.collection.name} (repo)` : ct.collection.name,
    path: `/${ct.collection.name}`,
    children: ct.nodes,
  }));

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 border-b border-sidebar-border p-3">
        <Link
          to="/"
          className="flex items-center gap-2 px-1 font-semibold text-foreground transition-colors hover:text-foreground/80"
          aria-label="diffwiki home"
        >
          <Logo className="size-6 shrink-0" />
          <span className="text-lg font-bold tracking-tight">diffwiki</span>
        </Link>
        <SearchBox placeholder="Search…" className="h-8 text-sm" />
      </SidebarHeader>

      <SidebarContent>
        <ScrollArea className="h-full">
          <SidebarGroup className="px-1.5">
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Collections
            </SidebarGroupLabel>
            {nodes.length > 0 ? (
              <NavTree nodes={nodes} />
            ) : (
              <div className="px-4 py-6 text-xs text-muted-foreground">No collections found.</div>
            )}
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>
    </Sidebar>
  );
}
