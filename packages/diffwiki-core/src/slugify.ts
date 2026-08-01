/** Turn a title (or a "# Heading" line) into a filesystem-safe slug. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/^#+\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

/** Slugify a `/`-separated path segment-by-segment, preserving the separators. */
export function slugifyPath(input: string): string {
  const segs = input
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => slugify(s));
  return segs.length > 0 ? segs.join('/') : 'untitled';
}
