import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';

/**
 * Thin top progress bar shown during route transitions — page loaders (fetching
 * article/nav JSON) can take a moment, so this gives immediate feedback. nprogress
 * style: creeps toward ~90% while loading, then snaps to 100% and fades out. No
 * dependency — driven purely by the router's pending/loading state. Renders `null`
 * (nothing in the SSR/hydrate output) when idle, so there is no hydration mismatch.
 */
export function RouteProgress() {
  const loading = useRouterState({ select: (s) => s.isLoading || s.status === 'pending' });
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    let hide: ReturnType<typeof setTimeout> | undefined;
    if (loading) {
      setVisible(true);
      setWidth(0);
      // Next frame: animate toward 90% via the long CSS transition (the "creep").
      raf = requestAnimationFrame(() => setWidth(90));
    } else if (visible) {
      setWidth(100);
      hide = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (hide) clearTimeout(hide);
    };
  }, [loading, visible]);

  if (!visible) return null;
  const complete = width === 100;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
      <div
        className="h-full bg-primary shadow-[0_0_8px_0] shadow-primary/50"
        style={{
          width: `${width}%`,
          opacity: complete ? 0 : 1,
          transition: complete
            ? 'width 150ms ease-out, opacity 300ms ease 150ms'
            : 'width 8s cubic-bezier(0.05, 0.7, 0.1, 1)',
        }}
      />
    </div>
  );
}
