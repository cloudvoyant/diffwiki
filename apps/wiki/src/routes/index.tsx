import { createFileRoute, Link } from '@tanstack/react-router';
import { getCollections } from '../server/collections';
import { Logo } from '../components/logo';
import { PageLayout } from '../components/page-layout';

export const Route = createFileRoute('/')({
  loader: () => getCollections(),
  component: HomeComponent,
});

function HomeComponent() {
  const collections = Route.useLoaderData();
  return (
    <PageLayout>
      <div className="flex min-h-[calc(100svh-var(--nav-h)-4rem)] flex-col items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-3 select-none">
          <Logo className="size-16 text-foreground" />
          <span className="text-5xl font-bold tracking-tight text-foreground">diffwiki</span>
          <span className="text-sm text-muted-foreground">your local knowledge base</span>
        </div>

        <div className="w-full max-w-md">
          <input
            type="search"
            placeholder="Search… (coming soon)"
            disabled
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Search (not yet functional)"
          />
        </div>

        {collections.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {collections.map((c) => (
              <Link
                key={c.name}
                to="/$coll/$"
                params={{ coll: c.name, _splat: '' }}
                className="inline-flex items-center rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {c.name}
                {c.type === 'repo' && <span className="ml-1.5 text-xs text-muted-foreground">(repo)</span>}
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
    </PageLayout>
  );
}
