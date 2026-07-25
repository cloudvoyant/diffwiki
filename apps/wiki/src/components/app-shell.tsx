import type { ReactNode } from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TopNav } from '@/components/top-nav';
import type { CollectionTree } from '@/lib/types';

interface AppShellProps {
  tree: CollectionTree[];
  children: ReactNode;
}

/**
 * AppShell — page skeleton.
 *
 *   Row 1 : full-width TopNav (sticky) — controls now, tabs later
 *   Row 2 : left Sidebar + content inset
 *
 * The SidebarProvider wraps everything (so the toggle in TopNav has context) but
 * is laid out as a column: the top bar spans the full width, and the sidebar
 * begins below it. The fixed sidebar rail is offset below the bar in CSS
 * (`[data-slot='sidebar-container']`). The right-hand TOC is injected by the
 * content route ($coll.$.tsx), not here.
 */
export function AppShell({ tree, children }: AppShellProps) {
  return (
    <SidebarProvider className="flex-col">
      <TopNav />

      <div className="flex min-h-0 w-full flex-1">
        <AppSidebar tree={tree} />
        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}
