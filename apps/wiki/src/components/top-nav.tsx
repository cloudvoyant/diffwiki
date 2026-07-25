import { Link } from '@tanstack/react-router';
import { Github, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { SettingsDialog } from '@/components/settings-dialog';
import { SearchBox } from '@/components/search-box';
import { Logo } from '@/components/logo';

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

/** The logo + wordmark home link that navigates back to the site root. */
function HomeLink() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-2 font-semibold text-foreground transition-colors hover:text-foreground/80"
      aria-label="diffwiki home"
    >
      <Logo className="size-6 shrink-0" />
      <span className="hidden text-lg font-bold tracking-tight sm:inline">diffwiki</span>
    </Link>
  );
}

/**
 * TopNav — full-width sticky bar above the sidebar and content. Holds the sidebar
 * toggle, the logo/wordmark home link, and the search box on the left, and the
 * settings + GitHub controls on the right. Breadcrumbs now live on the page
 * (above the article title), not here. Height is governed by the --nav-h CSS
 * custom property (3.5rem = h-14).
 */
export function TopNav() {
  return (
    <header className="sticky top-0 z-40 flex h-[var(--nav-h)] items-center gap-3 border-b bg-background px-2.5">
      <SidebarToggle />

      <HomeLink />

      <div className="min-w-0 max-w-xs flex-1">
        <SearchBox placeholder="Search…" className="h-9" />
      </div>

      {/* Right-side controls */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <SettingsDialog />

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
