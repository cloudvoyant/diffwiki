import type { ReactNode } from 'react';

/**
 * Shared page layout for everything rendered inside the content inset (home and
 * article pages both use this). It defines the single content lane + the fixed
 * right gutter so the content column and gutters stay identical across routes.
 *
 * The right gutter is always reserved (even when `aside` is empty) so the content
 * lane never shifts between pages. It holds the TOC on wide screens and collapses
 * below 1152px (responsive mode).
 */
export function PageLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex w-full items-start gap-8 px-8 py-10 lg:gap-12 lg:px-12">
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        className="sticky top-[calc(var(--nav-h)+1.5rem)] hidden shrink-0 self-start [@media(min-width:1152px)]:block"
        style={{ width: 'var(--toc-w)' }}
        aria-hidden={aside ? undefined : true}
      >
        {aside}
      </aside>
    </div>
  );
}
