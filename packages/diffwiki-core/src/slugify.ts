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
