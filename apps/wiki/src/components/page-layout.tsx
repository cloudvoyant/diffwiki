import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Page layout — owns the content lane, gutters, and optional TOC for every route
 * (mobile / tablet / desktop; see docs/architecture/app-shell.md).
 *
 * The sidebar always PUSHES this content inset (it is the outermost column), so
 * the lane centres within the inset — never under the sidebar:
 *   - below the desktop breakpoint the lane simply centres (`mx-auto`);
 *   - at desktop (`>=84rem`) a 3-column grid `[1fr | content | 1fr]` gives equal
 *     gutters inside the inset, and the TOC (when present) occupies the right one.
 *
 * The TOC never displaces the content lane — it lives in its own gutter cell, so a
 * page with a TOC and one without are laid out identically; the TOC just fills the
 * right gutter when that gutter exists (i.e. at desktop).
 */
export function PageLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div
      className={cn(
        'w-full px-4 py-8 sm:px-6 md:py-10 lg:px-8',
        'min-[84rem]:grid min-[84rem]:grid-cols-[1fr_minmax(0,var(--content-max))_1fr] min-[84rem]:items-start min-[84rem]:gap-x-10',
      )}
    >
      {/* Left gutter — keeps the content lane centred within the inset. */}
      <div aria-hidden className="hidden min-[84rem]:block" />

      <div className="mx-auto w-full min-w-0 max-w-[var(--content-max)] min-[84rem]:mx-0">{children}</div>

      {/* Right gutter — holds the TOC when present (desktop only). */}
      <div className="hidden min-[84rem]:block">
        {aside && (
          <aside className="sticky top-[calc(var(--nav-h)+1.5rem)] self-start" style={{ width: 'var(--toc-w)' }}>
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}
