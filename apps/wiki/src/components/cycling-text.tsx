import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

// useLayoutEffect on the client, useEffect on the server (avoids the SSR warning).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const ROLL_MS = 500;

/**
 * Cycles through `phrases` with a vertical roll: the current phrase slides up and
 * out while the next rolls in from below (slot-machine style — no cross-fade
 * ghosting, no blur). Clipped vertically with `clip-path` (top/bottom only) so the
 * box width can still animate to the active phrase and let surrounding words slide
 * without the wider phrase being horizontally clipped. SSR-stable: renders phrase 0
 * statically until mounted.
 */
export function CyclingText({
  phrases,
  intervalMs = 2600,
  className,
}: {
  phrases: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState<number>();
  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (phrases.length < 2) return;
    const id = setInterval(() => {
      setActive((i) => {
        setPrev(i);
        return (i + 1) % phrases.length;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [phrases.length, intervalMs]);

  // Drop the outgoing phrase once its roll-out finishes.
  useEffect(() => {
    if (prev == null) return;
    const t = setTimeout(() => setPrev(null), ROLL_MS + 20);
    return () => clearTimeout(t);
  }, [prev]);

  // Drive the container width from the active phrase so "knowledge base" slides.
  useIsoLayoutEffect(() => {
    if (activeRef.current) setWidth(activeRef.current.offsetWidth);
  }, [active, mounted]);

  // Server + first client render: the current phrase only (no mismatch).
  if (!mounted) return <span className={className}>{phrases[active]}</span>;

  return (
    <span
      className="relative inline-grid align-baseline transition-[width] duration-200 ease-out [clip-path:inset(-0.06em_-120px)]"
      style={width != null ? { width } : undefined}
    >
      {prev != null && prev !== active && (
        <span
          key={`out-${prev}`}
          aria-hidden
          className={cn('w-max [grid-area:1/1] whitespace-nowrap justify-self-start', className)}
          style={{ animation: `tagline-roll-out ${ROLL_MS}ms ease-out forwards` }}
        >
          {phrases[prev]}
        </span>
      )}
      <span
        key={`in-${active}`}
        ref={activeRef}
        aria-label={phrases[active]}
        className={cn(
          'w-max [grid-area:1/1] whitespace-nowrap justify-self-start motion-reduce:animate-none',
          className,
        )}
        // Roll only on a real change (prev set), not on first mount.
        style={prev != null ? { animation: `tagline-roll-in ${ROLL_MS}ms ease-out` } : undefined}
      >
        {phrases[active]}
      </span>
    </span>
  );
}
