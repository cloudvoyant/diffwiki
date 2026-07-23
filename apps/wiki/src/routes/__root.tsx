import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { loadNavTree } from '../lib/data-source';
import { AppShell } from '../components/app-shell';
import { THEME_INIT_SCRIPT } from '../components/theme-script';
import { LiveReload } from '../components/live-reload';

import appCss from '../styles.css?url';

export const Route = createRootRoute({
  loader: () => loadNavTree(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'diffwiki' },
      { name: 'description', content: 'Your local knowledge base.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      // Theme fonts (themes set --font-sans/-serif/-mono/-heading; system stacks
      // are the fallback, so this only upgrades rendering).
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Montserrat:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Oxanium:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Fira+Code:wght@400;500&family=Geist+Mono:wght@400;500&family=Source+Code+Pro:wght@400;500&display=swap',
      },
    ],
  }),
  component: RootLayout,
});

function RootLayout() {
  const tree = Route.useLoaderData();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppShell tree={tree}>
          <Outlet />
        </AppShell>
        <LiveReload />
        <Scripts />
      </body>
    </html>
  );
}
