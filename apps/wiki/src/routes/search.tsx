import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { runSearch } from '../server/search';
import { getSearchModes } from '../server/search';
import { getCollections } from '../server/collections';
import { PageLayout } from '../components/page-layout';
import { cn } from '../lib/utils';
import type { CollectionInfo, SearchResultItem } from '../lib/types';
import type { SearchMode } from 'diffwiki-core';

export const Route = createFileRoute('/search')({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === 'string' ? s.q : '',
    c: typeof s.c === 'string' ? s.c : undefined,
    engine: typeof s.engine === 'string' ? s.engine : undefined,
    type: typeof s.type === 'string' ? s.type : undefined,
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
    c: search.c,
    engine: search.engine,
    type: search.type,
  }),
  loader: async ({ deps }) => {
    const [search, collections, modes] = await Promise.all([
      runSearch({ data: { q: deps.q, collection: deps.c, engine: deps.engine, type: deps.type } }),
      getCollections(),
      getSearchModes(),
    ]);
    return { search, collections, modes };
  },
  component: SearchComponent,
});

function SearchComponent() {
  const { search, collections, modes } = Route.useLoaderData();
  const params = Route.useSearch();
  const navigate = Route.useNavigate();

  const [term, setTerm] = useState(params.q);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = term.trim();
    void navigate({ to: '/search', search: (prev) => ({ ...prev, q: value }) });
  };

  // The current mode key is "engine:type"; fall back to the first available mode
  // (always 'native:basic' at minimum) when neither param is set.
  const currentModeKey =
    params.engine && params.type
      ? `${params.engine}:${params.type}`
      : modes.length > 0
        ? `${modes[0].plugin}:${modes[0].type}`
        : '';

  const handleModeChange = (value: string) => {
    // Split on the first colon only so plugin names like "diffwiki-qmd" are safe.
    const colonIdx = value.indexOf(':');
    const engine = colonIdx >= 0 ? value.slice(0, colonIdx) : value;
    const type = colonIdx >= 0 ? value.slice(colonIdx + 1) : '';
    void navigate({
      to: '/search',
      search: (prev) => ({ ...prev, engine: engine || undefined, type: type || undefined }),
    });
  };

  const q = search.q.trim();

  return (
    <PageLayout>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        {/* Query bar — top-aligned (not vertically centred like the home hero) */}
        <form onSubmit={submit} role="search">
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </form>

        {/* Filters: collection + dynamic search-mode dropdown */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={params.c ?? ''}
            onChange={(e) => {
              const value = e.target.value || undefined;
              void navigate({ to: '/search', search: (prev) => ({ ...prev, c: value }) });
            }}
            aria-label="Filter by collection"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All collections</option>
            {collections.map((c: CollectionInfo) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          {modes.length > 0 && (
            <select
              value={currentModeKey}
              onChange={(e) => handleModeChange(e.target.value)}
              aria-label="Search mode"
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {modes.map((m: SearchMode) => {
                const key = `${m.plugin}:${m.type}`;
                return (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        {/* Results region */}
        {q === '' ? (
          <p className="text-sm text-muted-foreground">Type a query and press Enter.</p>
        ) : search.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No results for &ldquo;{q}&rdquo;.</p>
        ) : (
          <ul data-testid="search-results" className="flex flex-col divide-y divide-border">
            {search.results.map((r: SearchResultItem) => (
              <li key={`${r.coll}/${r.slug}`} className="py-3">
                <Link
                  to="/$coll/$"
                  params={{ coll: r.coll, _splat: r.slug }}
                  className={cn('group block focus:outline-none')}
                >
                  <span className="text-base font-medium text-foreground group-hover:underline">{r.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {r.coll}/{r.slug}
                  </span>
                  {r.snippet && (
                    <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">{r.snippet}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageLayout>
  );
}
