import { Link } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { SettingsDialog } from '@/components/settings-dialog';
import { SearchBox } from '@/components/search-box';
import { Logo } from '@/components/logo';
import type { SiteConfig } from '@/lib/types';

/** Solid GitHub mark (the filled Octocat) — theme-aware via currentColor. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12z" />
    </svg>
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

/** The diffwiki logo + wordmark home link. Fixed branding — this is a wiki, not a custom site. */
function HomeLink() {
  return (
    <Link
      to="/"
      // `-ml-1.5` tightens the space left of the logo (toward the sidebar toggle);
      // `gap-1` tightens the space between the logo mark and the wordmark.
      className="-ml-1.5 flex shrink-0 items-center gap-1 font-semibold text-foreground transition-colors hover:text-foreground/80"
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
export function TopNav({ site }: { site?: SiteConfig }) {
  return (
    // 3-column grid so the search sits centered in the bar regardless of the
    // left (toggle + wordmark) and right (controls) widths.
    <header className="sticky top-0 z-40 grid h-[var(--nav-h)] grid-cols-3 items-center gap-3 border-b bg-background px-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarToggle />
        <HomeLink />
      </div>

      <div className="mx-auto w-full max-w-sm">
        <SearchBox className="h-9" shortcut />
      </div>

      {/* Right-side controls */}
      <div className="flex shrink-0 items-center justify-end gap-1">
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
      </div>
    </header>
  );
}
