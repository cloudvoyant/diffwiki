import { createFileRoute, notFound } from '@tanstack/react-router';
import { loadPage } from '../lib/data-source';
import { ArticleBody } from '../components/article-body';
import { Toc } from '../components/toc';
import { KnowledgeGraph } from '../components/knowledge-graph';
import { DirListing } from '../components/dir-listing';
import { PageLayout } from '../components/page-layout';
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

  if (page.kind === 'listing') {
    return (
      <PageLayout>
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
      {/* Breadcrumbs and the page audience/draft indicator now live in the top nav. */}
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
      <ArticleBody key={`${page.coll}/${page.slug}`} html={page.html} />
    </PageLayout>
  );
}
