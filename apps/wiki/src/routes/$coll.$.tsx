import { createFileRoute, notFound, useLoaderData } from '@tanstack/react-router';
import { loadPage } from '../lib/data-source';
import { ArticleBody } from '../components/article-body';
import { Toc } from '../components/toc';
import { KnowledgeGraph } from '../components/knowledge-graph';
import { DirListing } from '../components/dir-listing';
import { PageLayout } from '../components/page-layout';
import { Breadcrumbs } from '../components/breadcrumbs';
import { AudienceBadge } from '../components/audience-badge';
import { DraftMark } from '../components/draft-mark';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/$coll/$')({
  loader: async ({ params }) => {
    const page = await loadPage(params.coll, params._splat ?? '');
    if (!page) throw notFound();
    return page;
  },
  component: CollectionDocPage,
});

/** Format an ISO date as a short, locale-aware "Mon D, YYYY"; passthrough if unparseable. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function CollectionDocPage() {
  const page = Route.useLoaderData();
  // The nav tree comes from the root loader; breadcrumbs resolve the trail from it.
  const tree = useLoaderData({ from: '__root__' });

  if (page.kind === 'listing') {
    return (
      <PageLayout>
        <div className="mb-4 flex items-center justify-between gap-4">
          <Breadcrumbs tree={tree} />
        </div>
        <DirListing title={page.title} entries={page.entries} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      aside={
        <>
          <KnowledgeGraph graph={page.graph} />
          <Toc items={page.toc} />
        </>
      }
    >
      {/* Row above the title: breadcrumbs left; far right shows the DRAFT mark when
          the article is a draft, otherwise its audience (Public/Private) badge. */}
      <div className="mb-4 flex items-center gap-3">
        <Breadcrumbs tree={tree} />
        {page.status === 'draft' ? (
          <DraftMark className="shrink-0" />
        ) : (
          <AudienceBadge audience={page.audience} className="shrink-0" />
        )}
      </div>

      <h1 className="mb-3 text-3xl font-bold tracking-tight">{page.title}</h1>

      {page.updated && <p className="mb-4 text-xs text-muted-foreground">Updated {formatDate(page.updated)}</p>}

      {page.tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {page.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Server-rendered HTML mounted directly — no client eval. */}
      <ArticleBody html={page.html} />
    </PageLayout>
  );
}
