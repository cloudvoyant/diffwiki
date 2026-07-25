import { listArticleTree, readArticle } from './browse';
import { listCollections } from './collections';
import { ArticleNotFoundError } from './errors';
import { renderArticle } from './render';
import type { ArticleNode, GraphEdge, GraphNode, LinkGraph, LocalGraph } from './types';

/** Namespaced id for a tag hub node, kept distinct from article ids (`coll/slug`). */
function tagId(tag: string): string {
  return `tag:${tag}`;
}

/**
 * Add a node for `coll/slug` (with its outgoing links + tags) if the slug resolves
 * to a real article — a file or a directory index page, both via {@link readArticle}.
 * A bare directory with no index is skipped (a listing, not a page).
 */
async function collectArticle(
  coll: string,
  slug: string,
  fallbackTitle: string | undefined,
  outNodes: GraphNode[],
  outEdges: GraphEdge[],
  outTags: Array<{ source: string; tag: string }>,
): Promise<void> {
  let art;
  try {
    art = await readArticle(coll, slug);
  } catch (err) {
    if (err instanceof ArticleNotFoundError) return; // bare directory — not a page
    throw err;
  }
  const id = `${coll}/${slug}`;
  outNodes.push({ id, kind: 'article', coll, slug, title: art.title ?? fallbackTitle ?? slug });
  const { links } = await renderArticle(art.body, { coll, slug, isIndex: art.isIndex });
  for (const target of links) outEdges.push({ source: id, target, kind: 'link' });
  for (const tag of art.tags) outTags.push({ source: id, tag });
}

/** Walk a collection's tree, adding a node for every leaf file and folder index. */
async function collectCollection(
  coll: string,
  nodes: ArticleNode[],
  outNodes: GraphNode[],
  outEdges: GraphEdge[],
  outTags: Array<{ source: string; tag: string }>,
): Promise<void> {
  for (const n of nodes) {
    if (n.slug) await collectArticle(coll, n.slug, n.title ?? n.name, outNodes, outEdges, outTags);
    if (n.children) await collectCollection(coll, n.children, outNodes, outEdges, outTags);
  }
}

let cached: LinkGraph | undefined;

/** Clear the memoised whole-wiki graph (tests; future live-reload invalidation). */
export function invalidateLinkGraph(): void {
  cached = undefined;
}

/**
 * Build the whole-wiki graph: one node per article, one directed edge per resolved
 * internal link (self/dead/external dropped, duplicates collapsed), plus tag hubs.
 * Memoised per process; {@link invalidateLinkGraph} clears it.
 *
 * TODO(live-reload): the memo is process-keyed and the dynamic server fn never
 * invalidates, so a long-lived server freezes the graph until restart.
 */
export async function buildLinkGraph(): Promise<LinkGraph> {
  if (cached) return cached;
  const nodes: GraphNode[] = [];
  const rawEdges: GraphEdge[] = [];
  const rawTags: Array<{ source: string; tag: string }> = [];
  for (const e of await listCollections()) {
    try {
      // Collection-root index (served at `/{coll}`) — id `${coll}/`, matching resolvePage.
      await collectArticle(e.name, '', e.name, nodes, rawEdges, rawTags);
      await collectCollection(e.name, await listArticleTree(e.name), nodes, rawEdges, rawTags);
    } catch {
      /* skip collections whose content dir is missing/unreadable */
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of rawEdges) {
    if (edge.source === edge.target) continue; // no self-loops
    if (!nodeIds.has(edge.target)) continue; // drop dangling/external targets
    const key = `${edge.source} ${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }
  // Tag hubs: one node per tag + an article→hub edge, so co-tagged pages connect
  // through the hub rather than a dense article↔article clique.
  const tagSeen = new Set<string>();
  for (const { source, tag } of rawTags) {
    if (!nodeIds.has(source)) continue;
    const id = tagId(tag);
    if (!tagSeen.has(id)) {
      tagSeen.add(id);
      nodes.push({ id, kind: 'tag', coll: '', slug: '', title: `#${tag}` });
    }
    const key = `${source} ${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target: id, kind: 'tag' });
  }
  cached = { nodes, edges };
  return cached;
}

/**
 * Slice the local neighbourhood of `focusId`: the focus, its direct link neighbours,
 * its tag hubs, and its co-tagged sibling articles (2 hops through a shared hub, so
 * the tag-proximity view has neighbours rather than a lone dot). All edges among the
 * kept nodes are retained; an unknown focus yields an empty-but-focused graph.
 * `siblingCap` bounds the co-tagged siblings pulled in.
 *
 * `include` prunes to the given collection set before slicing (tag hubs kept), so a
 * subset export's preview never links to an excluded page.
 */
export function localGraph(
  graph: LinkGraph,
  focusId: string,
  include?: ReadonlySet<string>,
  siblingCap = 12,
): LocalGraph {
  const scoped: LinkGraph = include
    ? {
        // Tag hubs survive the filter — never a page, so they can't 404.
        nodes: graph.nodes.filter((n) => n.kind === 'tag' || include.has(n.coll)),
        edges: graph.edges,
      }
    : graph;
  const byId = new Map(scoped.nodes.map((n) => [n.id, n]));
  const focus = byId.get(focusId);
  if (!focus) return { focus: focusId, nodes: [], edges: [] };

  const keep = new Set<string>([focusId]);
  for (const e of scoped.edges) {
    if (e.source === focusId && byId.has(e.target)) keep.add(e.target);
    if (e.target === focusId && byId.has(e.source)) keep.add(e.source);
  }
  // 2-hop: co-tagged siblings via a kept tag hub.
  const focusTagHubs = new Set([...keep].filter((id) => byId.get(id)?.kind === 'tag'));
  let siblings = 0;
  for (const e of scoped.edges) {
    if (siblings >= siblingCap) break;
    if (e.kind === 'tag' && focusTagHubs.has(e.target) && byId.has(e.source) && !keep.has(e.source)) {
      keep.add(e.source);
      siblings++;
    }
  }
  const nodes = scoped.nodes.filter((n) => keep.has(n.id));
  const edges = scoped.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { focus: focusId, nodes, edges };
}
