import { listCollections } from './collections';
import { listArticleTree, readArticle, collectionMeta } from './browse';
import { renderArticle } from './render';
import { buildLinkGraph, localGraph } from './graph';
import { collectionGitStatus } from './repo';
import { fileTimestamps } from './git';
import { ArticleNotFoundError, CollectionNotFoundError } from './errors';
import { readSiteConfig } from './project';
import type {
  ArticleNode,
  CollectionEntry,
  CollectionInfo,
  CollectionTree,
  ListingEntry,
  PageData,
  SiteConfig,
  TreeNode,
} from './types';

const isStatic = (): boolean => process.env.DIFFWIKI_STATIC === '1';

/** Map core article nodes to UI nav nodes, assigning each its route path.
 *  In static builds, private (audience) or draft (status) articles are dropped
 *  entirely (no nav row, and — since routes + per-doc JSON derive from this tree
 *  — no route/JSON). */
export function toTreeNodes(coll: string, nodes: ArticleNode[]): TreeNode[] {
  const visible = isStatic() ? nodes.filter((n) => n.audience !== 'private' && n.status !== 'draft') : nodes;
  return visible.map((n) =>
    n.children
      ? {
          name: n.name,
          title: n.title ?? n.name,
          path: n.slug ? `/${coll}/${n.slug}` : undefined,
          ...(n.audience ? { audience: n.audience } : {}),
          ...(n.status ? { status: n.status } : {}),
          children: toTreeNodes(coll, n.children),
        }
      : {
          name: n.name,
          title: n.title ?? n.name,
          path: `/${coll}/${n.slug}`,
          ...(n.audience ? { audience: n.audience } : {}),
          ...(n.status ? { status: n.status } : {}),
        },
  );
}

/** Branch/behind for the sidebar, omitted (with a warning) during static builds. */
async function gitInfo(e: CollectionEntry): Promise<{ branch?: string; behind?: number }> {
  if (isStatic()) {
    if (e.type === 'external') console.warn(`[diffwiki] static build: omitting branch info for "${e.name}"`);
    return {};
  }
  const s = await collectionGitStatus(e);
  return s ? { branch: s.branch, behind: s.hasUpstream ? s.behind : undefined } : {};
}

export async function buildCollections(): Promise<CollectionInfo[]> {
  const entries = await listCollections();
  const infos = await Promise.all(
    entries.map(async (e): Promise<CollectionInfo> => {
      const { title, audience, status } = await collectionMeta(e.path);
      return {
        name: e.name,
        type: e.type,
        path: e.path,
        ...(title ? { title } : {}),
        ...(await gitInfo(e)),
        ...(audience ? { audience } : {}),
        ...(status ? { status } : {}),
      };
    }),
  );
  // A collection marked private (audience) or draft (status) in its index is dropped from static builds.
  return isStatic() ? infos.filter((c) => c.audience !== 'private' && c.status !== 'draft') : infos;
}

export async function buildNavTree(): Promise<CollectionTree[]> {
  const entries = await listCollections();
  const trees = await Promise.all(
    entries.map(async (e): Promise<CollectionTree> => {
      const { title, audience, status } = await collectionMeta(e.path);
      return {
        collection: {
          name: e.name,
          type: e.type,
          path: e.path,
          ...(title ? { title } : {}),
          ...(await gitInfo(e)),
          ...(audience ? { audience } : {}),
          ...(status ? { status } : {}),
        },
        nodes: toTreeNodes(e.name, await listArticleTree(e.name)),
      };
    }),
  );
  // Drop private/draft collections entirely from static builds (nav → routes → JSON all derive from here).
  return isStatic()
    ? trees.filter((t) => t.collection.audience !== 'private' && t.collection.status !== 'draft')
    : trees;
}

function findNode(nodes: ArticleNode[], slug: string): ArticleNode | undefined {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    if (n.children) {
      const found = findNode(n.children, slug);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Resolve a route to a rendered doc or a generated directory listing (or null).
 *
 * `opts.include` restricts the doc's sidebar `graph` preview to the given set of
 * collection names — supplied by the static exporter for subset exports so the
 * per-page local graph matches the filtered overlay `graph.json` and never links
 * to a page that was excluded from the build. Omitting it (the dynamic server
 * path, which serves every collection) keeps the whole-wiki neighbourhood.
 */
export async function resolvePage(
  coll: string,
  slug: string,
  opts?: { include?: ReadonlySet<string> },
): Promise<PageData | null> {
  try {
    const art = await readArticle(coll, slug);
    const { html, toc } = await renderArticle(art.body, {
      coll: art.coll,
      slug: art.slug,
      isIndex: art.isIndex,
    });
    const { created, updated } = await fileTimestamps(art.path);
    const graph = localGraph(await buildLinkGraph(), `${art.coll}/${art.slug}`, opts?.include);
    return {
      kind: 'doc',
      coll: art.coll,
      slug: art.slug,
      title: art.title,
      tags: art.tags,
      ...(art.audience === 'private' ? { audience: art.audience } : {}),
      ...(art.status === 'draft' ? { status: art.status } : {}),
      html,
      toc,
      path: `/${art.coll}/${art.slug}`,
      created,
      updated,
      graph,
    };
  } catch (err) {
    if (err instanceof CollectionNotFoundError) return null;
    if (!(err instanceof ArticleNotFoundError)) throw err;
    let nodes: ArticleNode[];
    try {
      nodes = await listArticleTree(coll);
    } catch (e) {
      if (e instanceof CollectionNotFoundError) return null;
      throw e;
    }
    const folder = slug ? findNode(nodes, slug) : { title: undefined, children: nodes };
    if (!folder?.children) return null;
    const entries: ListingEntry[] = folder.children.map((n) => ({
      name: n.name,
      title: n.title ?? n.name,
      path: `/${coll}/${n.slug ?? n.name}`,
      isDir: Array.isArray(n.children),
    }));
    return {
      kind: 'listing',
      coll,
      slug,
      title: folder.title ?? (slug ? (slug.split('/').pop() ?? slug) : coll),
      entries,
    };
  }
}

/**
 * The site config for the current context, from `diffwiki.yaml` at
 * `DIFFWIKI_PROJECT_DIR`. Returns `{}` when the env var is unset (the default
 * runtime) or the file is missing/unreadable — the home page then falls back to
 * collection pills. Consumed by the static exporter (site.json) and the live
 * `getSite` server fn.
 */
export async function buildSiteConfig(): Promise<SiteConfig> {
  const dir = process.env.DIFFWIKI_PROJECT_DIR;
  if (!dir) return {};
  try {
    return await readSiteConfig(dir);
  } catch {
    return {};
  }
}
