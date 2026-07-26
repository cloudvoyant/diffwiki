import { useEffect, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

interface SearchBoxProps {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Register a ⌘K / Ctrl+K shortcut that focuses this input, and show the hint. */
  shortcut?: boolean;
}

/**
 * Controlled search input. On submit it navigates to `/search?q=…` — the same on
 * the live app and the static export. The `/search` route resolves results via the
 * data-source seam: the server engine live, or the shared BM25 scorer over the
 * pre-built index client-side when static. Shared by the home hero and the top nav.
 */
export function SearchBox({ className, placeholder = 'Search', autoFocus = false, shortcut = false }: SearchBoxProps) {
  // Current URL search params, so the box pre-fills/stays in sync on /search and a
  // new query preserves the collection filter + engine/type mode.
  const urlSearch = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const urlQuery = str(urlSearch.q) ?? '';
  const [value, setValue] = useState(urlQuery);
  const [isMac, setIsMac] = useState(true);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with the URL when it changes (navigation, back/forward, direct load).
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (!shortcut) return;
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    // Preserve any existing search params (collection filter + engine/type mode) so
    // refining the query doesn't reset the user's selected search mode to the default.
    void navigate({
      to: '/search',
      search: { q, c: str(urlSearch.c), engine: str(urlSearch.engine), type: str(urlSearch.type) },
    });
  };

  return (
    <form onSubmit={submit} action="/search" method="get" role="search" className="relative">
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Search"
        className={cn(
          'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
          // Hide the native (accent-tinted) clear button; we render a theme-aware one.
          '[&::-webkit-search-cancel-button]:appearance-none',
          value ? 'pr-8' : shortcut ? 'pr-14' : '',
          className,
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue('')}
          className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : shortcut ? (
        <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground select-none sm:flex">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      ) : null}
    </form>
  );
}
