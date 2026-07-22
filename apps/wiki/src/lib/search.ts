import path from 'node:path';
import type { QueryHit, CollectionEntry } from 'diffwiki-core';
import type { SearchResultItem } from './types';

/** Strip a trailing `.md` / `.mdx` extension and normalise backslashes to `/`. */
function toSlug(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/\.mdx?$/i, '');
}

/**
 * Map an absolute-path `QueryHit` to route-ready `SearchResultItem`.
 *
 * We find the owning collection by checking which registered collection's
 * absolute `path` is a prefix of `hit.path` — this handles in-repo wikis that
 * live outside `~/.diffwiki` at arbitrary paths (name alone is insufficient).
 * When no prefix match is found we fall back to `hit.collection` + the file
 * basename, which at least gives a navigable link for plugins that set the
 * collection field correctly even when the path is not under a known root.
 */
export function hitToResult(hit: QueryHit, collections: CollectionEntry[]): SearchResultItem {
  // Normalise the hit path to use forward slashes so the prefix check is
  // consistent on all platforms (Windows paths from plugins would have backslashes).
  const hitPath = hit.path.replace(/\\/g, '/');

  const coll = collections.find((c) => {
    const collPath = c.path.replace(/\\/g, '/');
    // Ensure we match a real directory boundary, not just a shared prefix string.
    return hitPath.startsWith(collPath + '/') || hitPath === collPath;
  });

  if (coll) {
    return {
      coll: coll.name,
      slug: toSlug(path.relative(coll.path, hit.path)),
      title: hit.title,
      snippet: hit.snippet,
      score: hit.score,
    };
  }

  // Fallback: unknown collection — use the basename so the result is still
  // renderable (the link may 404 if the slug does not match a route, but the
  // results list will not crash).
  return {
    coll: hit.collection,
    slug: toSlug(path.basename(hit.path)),
    title: hit.title,
    snippet: hit.snippet,
    score: hit.score,
  };
}
