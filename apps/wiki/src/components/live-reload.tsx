import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

/**
 * Re-renders the current page when its source file changes on disk.
 *   - Baseline: revalidate loaders when the tab regains focus (no deps, always works).
 *   - Live: subscribe to /api/watch (SSE) and invalidate on any article change.
 * router.invalidate() re-runs active loaders; only the current route re-fetches, so a
 * broad "invalidate on any change" is fine and keeps this trivial.
 */
export function LiveReload() {
  const router = useRouter();
  useEffect(() => {
    if (import.meta.env.VITE_DIFFWIKI_STATIC === '1') return; // static: no server, nothing to watch

    const onVisible = () => {
      if (document.visibilityState === 'visible') void router.invalidate();
    };
    document.addEventListener('visibilitychange', onVisible);

    const es = new EventSource('/api/watch');
    es.onmessage = () => {
      void router.invalidate();
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; nothing to do */
    };

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      es.close();
    };
  }, [router]);

  return null;
}
