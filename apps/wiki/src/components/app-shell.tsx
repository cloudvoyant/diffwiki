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
 *   Column 1 : full-height left Sidebar (primary navigation — logo, search,
 *              collection tree, settings + GitHub at the foot).
 *   Column 2 : content inset — a sticky TopNav (sidebar trigger, breadcrumbs,
 *              page audience/status) above the page content and footer.
 *
 * The sidebar now sits higher in the DOM than the top nav: the SidebarProvider
 * lays out as a row (its default flex direction), the sidebar is the first,
 * full-viewport-height column, and the TopNav lives inside the content column
 * to its right — it no longer spans the full width above the sidebar. The
 * right-hand TOC is injected by the content route ($coll.$.tsx), not here.
 *
 * The content inset fills at least the viewport below the nav, with the page
 * growing (flex-1) and the footer pinned beneath it: a short page (e.g. home)
 * fits in vh − nav − footer without scrolling; longer content scrolls.
 */
export function AppShell({ tree, site, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar tree={tree} site={site} />
      <SidebarInset className="min-w-0">
        <TopNav tree={tree} />
        {/* Fill ≥ viewport below the nav; footer pinned beneath the content. */}
        <div className="flex min-h-[calc(100svh-var(--nav-h))] flex-col">
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter copyright={site?.copyright} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
