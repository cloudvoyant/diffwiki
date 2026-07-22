// apps/wiki/src/components/toc.tsx
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import type { TocItem } from '../lib/types';

export interface TocProps {
  items: TocItem[];
}

const SCROLL_OFFSET = 120; // px from top of viewport; heading is "active" when above this

/**
 * Right-column scroll-spy table of contents.
 *
 * Active heading = the last h2/h3 whose top edge is at or above SCROLL_OFFSET px.
 * Falls through to the first item if none qualify (e.g. at the very top of the page).
 * At the bottom of the page the last item is always active regardless of position.
 *
 * Depth indent: calc(0.75rem + (depth-2) * 0.75rem)
 *   depth-2 (h2) → 0.75rem
 *   depth-3 (h3) → 1.5rem
 *
 * Active link:  text-primary + left border color = --primary
 * Inactive:     text-muted-foreground, left border transparent
 *
 * Only renders depth 2–3 items (filtered from the items prop in case deeper
 * headings leak through from the TOC extraction).
 */
export function Toc({ items }: TocProps) {
  const [active, setActive] = useState<string>('');
  const rafRef = useRef<number>(0);

  const visible = items.filter((item) => item.depth >= 2 && item.depth <= 3);

  useEffect(() => {
    if (visible.length === 0) return;

    const compute = () => {
      rafRef.current = 0;

      const last = visible[visible.length - 1];
      const scrollEl = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= scrollEl.scrollHeight - 2;

      if (atBottom && last) {
        setActive(last.slug);
        return;
      }

      let current = visible[0]?.slug ?? '';
      for (const item of visible) {
        const el = document.getElementById(item.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= SCROLL_OFFSET) {
          current = item.slug;
        } else {
          break;
        }
      }
      setActive(current);
    };

    const onScroll = () => {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(compute);
      }
    };

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  if (visible.length === 0) return null;

  return (
    <nav aria-label="Table of contents" className="sticky top-[calc(var(--nav-h)+1.5rem)] text-[0.8125rem]">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
      {/* The border-l is a continuous rail; each item overlaps it with its own
          2px border (-ml-px) whose color transitions to primary when active. */}
      <ul className="border-l border-border">
        {visible.map((item) => (
          <li key={item.slug}>
            <a
              href={`#${item.slug}`}
              className={cn(
                '-ml-px block border-l-2 py-0.5 leading-snug text-muted-foreground transition-colors hover:text-foreground',
                active === item.slug && 'font-medium text-primary',
              )}
              style={{
                borderLeftColor: active === item.slug ? 'var(--primary)' : 'transparent',
                paddingLeft: `${0.625 + (item.depth - 2) * 0.625}rem`,
              }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
