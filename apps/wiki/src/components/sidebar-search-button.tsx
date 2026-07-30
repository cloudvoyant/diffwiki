import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sidebar search control — a button (not an input) styled like a muted search
 * field. Clicking it navigates to the search page; the actual query input lives
 * on /search. A ⌘K / Ctrl K hint mirrors the global shortcut registered by the
 * sidebar (see AppSidebar). Kept deliberately simple: navigate-only, no inline
 * typeahead.
 */
export function SidebarSearchButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  // Default false so non-Mac desktop users don't see a one-paint "⌘K" flash before
  // the effect resolves the platform. The kbd hint is desktop-only (hidden sm:flex).
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);

  return (
    <button
      type="button"
      onClick={() =>
        void navigate({ to: '/search', search: { q: '', c: undefined, engine: undefined, type: undefined } })
      }
      aria-label="Search"
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 text-left">Search</span>
      <kbd className="pointer-events-none hidden items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground select-none sm:flex">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}
