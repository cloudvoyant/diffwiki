import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { loadSearch, loadCollections, loadSearchModes } from '../lib/data-source';
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
    const [search, collections, searchModes] = await Promise.all([
      loadSearch({ q: deps.q, c: deps.c, engine: deps.engine, type: deps.type }),
      loadCollections(),
      loadSearchModes(),
    ]);
    return { search, collections, modes: searchModes.modes, defaultMode: searchModes.default };
  },
  component: SearchComponent,
  // Semantic/hybrid searches can take several seconds (the qmd model loads per
  // query), so show a spinner while the loader runs instead of freezing the UI.
  pendingComponent: SearchPending,
  pendingMs: 150,
});

const QUERY_INPUT_CLASS =
  'w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** Human-friendly search duration: sub-second in ms, else seconds with one decimal. */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Shown while the search loader is in flight — keeps the query bar usable. */
function SearchPending() {
  const params = Route.useSearch();
  const navigate = Route.useNavigate();
  const [term, setTerm] = useState(params.q);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({ to: '/search', search: (prev) => ({ ...prev, q: term.trim() }) });
  };

  return (
    <PageLayout>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <form onSubmit={submit} role="search">
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className={QUERY_INPUT_CLASS}
          />
        </form>
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status" aria-live="polite">
          <span
            className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
            aria-hidden
          />
          Searching…
        </div>
      </div>
    </PageLayout>
  );
}

function SearchComponent() {
  const loader = Route.useLoaderData();
  const { collections, modes, defaultMode } = loader;
  const params = Route.useSearch();
  const navigate = Route.useNavigate();

  const [term, setTerm] = useState(params.q);

  // Static builds have no server: prerendered `/search` ships an empty result set,
  // so compute results on the client whenever the query/collection changes — this
  // covers both in-app navigation AND a direct load of `/search?q=…` (refresh /
  // shared link). The index fetch is memoised, so this is just a re-rank. Live
  // builds render the server loader's results directly.
  const isStatic = import.meta.env.VITE_DIFFWIKI_STATIC === '1';
  const [clientSearch, setClientSearch] = useState(loader.search);
  useEffect(() => {
    if (!isStatic) return;
    let cancelled = false;
    void loadSearch({ q: params.q, c: params.c }).then((r) => {
      if (!cancelled) setClientSearch(r);
    });
    return () => {
      cancelled = true;
    };
  }, [isStatic, params.q, params.c]);
  const search = isStatic ? clientSearch : loader.search;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = term.trim();
    void navigate({ to: '/search', search: (prev) => ({ ...prev, q: value }) });
  };

  // The current mode key is "engine:type". When the URL omits engine/type, reflect
  // the engine the server actually runs (resolved via config.defaultSearch / first
  // enabled plugin / native) rather than blindly showing the first listed mode.
  const currentModeKey =
    params.engine && params.type ? `${params.engine}:${params.type}` : `${defaultMode.engine}:${defaultMode.type}`;

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
            className={QUERY_INPUT_CLASS}
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

        {/* Engine-failure notice: the resolved engine broke and native ran instead. */}
        {q !== '' && search.engineError && (
          <p className="text-xs text-muted-foreground" role="status" data-testid="search-engine-error">
            Search engine failed ({search.engineError}) — showing native results.
          </p>
        )}

        {/* Results region */}
        {q === '' ? (
          <p className="text-sm text-muted-foreground">Type a query and press Enter.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground" data-testid="search-meta">
              {search.results.length} result{search.results.length === 1 ? '' : 's'} · {formatDuration(search.tookMs)}
            </p>
            {search.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No results for &ldquo;{q}&rdquo;.</p>
            ) : (
              <ul data-testid="search-results" className="flex flex-col divide-y divide-border">
                {search.results.map((r: SearchResultItem) => (
                  <li key={`${r.coll}/${r.slug}`} className="py-3" data-collection={r.coll}>
                    <Link
                      to="/$coll/$"
                      params={{ coll: r.coll, _splat: r.slug }}
                      className={cn('group block focus:outline-none')}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-base font-medium text-foreground group-hover:underline">{r.title}</span>
                        {typeof r.score === 'number' && (
                          <span
                            className="shrink-0 font-mono text-xs text-muted-foreground/70 tabular-nums"
                            title="Relevance score (scale is mode-dependent)"
                          >
                            {r.score.toFixed(2)}
                          </span>
                        )}
                      </span>
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
        )}
      </div>
    </PageLayout>
  );
}
