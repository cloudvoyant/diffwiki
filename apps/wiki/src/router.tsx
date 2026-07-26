import { createRouter as createTanStackRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
// Side-effect import: configures LogTape once so diffwiki-core `getLogger`
// calls in server functions and shared code emit. Guarded internally.
import './lib/logging';

function NotFound() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-lg font-semibold text-foreground">Page not found</p>
      <p className="text-sm text-muted-foreground">That collection or article doesn’t exist.</p>
    </div>
  );
}

function RouteError({ error }: ErrorComponentProps) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-lg font-semibold text-foreground">Couldn’t load this page</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {error?.message || 'Something went wrong while loading the content.'}
      </p>
    </div>
  );
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    basepath: import.meta.env.BASE_URL,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Only preload after the pointer rests ~80ms on a link, so the mouse merely
    // passing over links doesn't spin up (then immediately tear down) preload
    // matches — that churn is what races match cleanup and trips the caught-but-
    // noisy `_nonReactive` undefined in router-core's preloadRoute.
    defaultPreloadDelay: 80,
    // Keep TanStack's default preload stale time (30s) rather than forcing a fresh
    // preload on every hover (`defaultPreloadStaleTime: 0` re-creates a match on
    // each intent, worsening the same race). A click still re-validates, so serving
    // a wiki page from a <30s-old preload is fine.
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
