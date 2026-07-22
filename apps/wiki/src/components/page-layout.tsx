import type { ReactNode } from 'react';

/**
 * Shared page layout for everything rendered inside the content inset (home and
 * article pages both use this).
 *
 * The content lane has a FIXED max width (`--content-max`), so it stays the same
 * width whether or not a TOC is showing. The lane + TOC form a group that is
 * centred in the inset (`mx-auto` + `justify-center`): on wide screens the TOC
 * sits in the right gutter; once it hides (below 1152px, or on any page without
 * a TOC) the lane centres itself with symmetric gutters rather than growing to
 * fill or shifting left. The TOC gutter is only reserved when there is a TOC —
 * pages without one (home, search, listings) stay centred at every width.
 */
export function PageLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[calc(var(--content-max)_+_var(--toc-w)_+_3rem)] items-start justify-center gap-8 px-4 py-8 sm:px-6 md:py-10 lg:gap-12 lg:px-8">
      <div className="w-full min-w-0 max-w-[var(--content-max)]">{children}</div>
      {aside && (
        <aside
          className="sticky top-[calc(var(--nav-h)+1.5rem)] hidden shrink-0 self-start [@media(min-width:1152px)]:block"
          style={{ width: 'var(--toc-w)' }}
        >
          {aside}
        </aside>
      )}
    </div>
  );
}
