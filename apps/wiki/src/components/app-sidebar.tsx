import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel } from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NavTree } from './nav-tree';
import type { CollectionTree, TreeNode } from '../lib/types';

/**
 * Left sidebar (below the top bar): the collection nav. The logo + search now
 * live in the top bar, so the sidebar is nav-only.
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
    audience: ct.collection.audience,
    status: ct.collection.status,
    children: ct.nodes,
    meta: ct.collection.branch ? { branch: ct.collection.branch, behind: ct.collection.behind } : undefined,
  }));

  return (
    <Sidebar>
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
