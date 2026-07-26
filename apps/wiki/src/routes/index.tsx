import { createFileRoute, Link } from '@tanstack/react-router';
import { loadCollections, loadSite } from '../lib/data-source';
import { Logo } from '../components/logo';
import { SearchBox } from '../components/search-box';
import { HomeCards } from '../components/home-cards';
import { CyclingText } from '../components/cycling-text';

// The animated default tagline: "your <cycling adjective> knowledge base".
const TAGLINE_PHRASES = ['local-first', 'git-native', 'agent-friendly', 'self-improving'];

export const Route = createFileRoute('/')({
  loader: async () => ({ collections: await loadCollections(), site: await loadSite() }),
  component: HomeComponent,
});

function HomeComponent() {
  const { collections, site } = Route.useLoaderData();
  const customTagline = site.home?.tagline;
  const cards = site.home?.cards ?? [];
  // Only mark "(repo)" when collections mix types — in a single-project publish
  // every collection is type 'repo', so the marker would just be noise.
  const mixedTypes = collections.some((c) => c.type !== 'repo');

  return (
    // Fill the content area (flex-1 from AppShell) and center — so the home fits
    // within vh − nav − footer and only scrolls if its own content overflows.
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
      <div className="flex w-full flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 select-none">
          <Logo className="size-16 text-foreground" />
          <span className="text-5xl font-bold tracking-tight text-foreground">diffwiki</span>
          <span className="text-sm text-muted-foreground">
            {customTagline ? (
              customTagline
            ) : (
              <>
                your <CyclingText phrases={TAGLINE_PHRASES} className="font-medium text-foreground" /> knowledge base
              </>
            )}
          </span>
        </div>

        <div className="w-full max-w-md">
          <SearchBox className="w-full" placeholder="Search" autoFocus />
        </div>

        {cards.length > 0 ? (
          <HomeCards cards={cards} />
        ) : collections.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {collections.map((c) => (
              <Link
                key={c.name}
                to="/$coll/$"
                params={{ coll: c.name, _splat: '' }}
                className="inline-flex items-center rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {c.title ?? c.name}
                {mixedTypes && c.type === 'repo' && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(repo)</span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No collections yet. Run{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">diffwiki create</code> to start.
          </p>
        )}
      </div>
    </div>
  );
}
