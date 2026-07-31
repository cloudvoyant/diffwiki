import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageStatusIndicator } from '@/components/page-status-indicator';
import { cn } from '@/lib/utils';
import type { CollectionTree } from '@/lib/types';

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
 * TopNav — sticky bar inside the content column (to the right of the sidebar),
 * not full-width. Holds the sidebar toggle and breadcrumbs on the left, and the
 * current page's audience/status indicator on the far right. Branding, search,
 * settings, and GitHub now live in the sidebar. Breadcrumbs are hidden below the
 * `md` breakpoint. Height is governed by the --nav-h CSS custom property.
 */
export function TopNav({ tree }: { tree: CollectionTree[] }) {
  const { state, isMobile } = useSidebar();
  // On desktop (>=84rem) the sidebar OVERLAYS the left gutter and sits ABOVE this
  // bar. When it's open, pad the nav's controls out past the sidebar width so the
  // trigger isn't hidden behind it; collapsed → no offset (trigger sits flush left).
  const openOnDesktop = !isMobile && state === 'expanded';
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-[var(--nav-h)] items-center gap-3 border-b bg-background px-2.5 pr-5 transition-[padding-left] duration-200 ease-linear',
        openOnDesktop && 'min-[84rem]:pl-[calc(var(--sidebar-width)+1rem)]',
      )}
    >
      <SidebarToggle />
      <div className="hidden min-w-0 flex-1 md:flex">
        <Breadcrumbs tree={tree} />
      </div>
      <div className="ml-auto flex shrink-0 items-center md:ml-0">
        <PageStatusIndicator tree={tree} />
      </div>
    </header>
  );
}
