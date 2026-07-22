import { createFileRoute, notFound } from '@tanstack/react-router';
import { readPage } from '../server/doc';
import { ArticleBody } from '../components/article-body';
import { Toc } from '../components/toc';
import { DirListing } from '../components/dir-listing';
import { PageLayout } from '../components/page-layout';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/$coll/$')({
  loader: async ({ params }) => {
    // readPage returns null only for a genuine miss; real errors propagate.
    const page = await readPage({ data: { coll: params.coll, slug: params._splat ?? '' } });
    if (!page) throw notFound();
    return page;
  },
  component: CollectionDocPage,
});

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
    <PageLayout aside={<Toc items={page.toc} />}>
      <h1 className="mb-3 text-3xl font-bold tracking-tight">{page.title}</h1>

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
