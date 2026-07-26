import type { ReactNode } from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TopNav } from '@/components/top-nav';
import { SiteFooter } from '@/components/site-footer';
import type { CollectionTree, SiteConfig } from '@/lib/types';

interface AppShellProps {
  tree: CollectionTree[];
  site?: SiteConfig;
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
 *
 * The content inset fills at least the viewport below the nav, with the page
 * growing (flex-1) and the footer pinned beneath it: a short page (e.g. home)
 * fits in vh − nav − footer without scrolling; longer content scrolls.
 */
export function AppShell({ tree, site, children }: AppShellProps) {
  return (
    <SidebarProvider className="flex-col">
      <TopNav site={site} />

      <div className="flex min-h-0 w-full flex-1">
        <AppSidebar tree={tree} />
        <SidebarInset className="min-w-0">
          {/* Fill ≥ viewport below the nav; footer pinned beneath the content. */}
          <div className="flex min-h-[calc(100svh-var(--nav-h))] flex-col">
            <div className="flex flex-1 flex-col">{children}</div>
            <SiteFooter copyright={site?.copyright} />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
