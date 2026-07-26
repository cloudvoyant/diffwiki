import { findCollection } from './collections';
import { readArticle } from './browse';
import { resolveCwdCollection } from './repo';
import { collectionsDir } from './paths';
import { getConfigValue } from './config';
import { CollectionNotFoundError } from './errors';

/** What `diffwiki edit` resolved to open: a single article file, a collection dir, or the collections root. */
export interface EditTarget {
  /** Absolute filesystem path to hand to the editor. */
  path: string;
  kind: 'article' | 'collection' | 'root';
}

/**
 * Resolve the filesystem path `diffwiki edit [target]` should open.
 *
 * - `collection:slug` → that article's file (throws if the article/collection is missing).
 * - `collection`      → that collection's content directory.
 * - (no target)       → the current repo's collection dir, else the `~/.diffwiki/collections` root.
 */
export async function resolveEditTarget(target: string | undefined, cwd: string): Promise<EditTarget> {
  if (target && target.trim()) {
    const [coll, ...rest] = target.trim().split(':');
    const slug = rest.join(':');
    const entry = await findCollection(coll);
    if (!entry) throw new CollectionNotFoundError(coll);
    if (slug) {
      // Throws ArticleNotFoundError for a bad slug — edit opens existing files, it doesn't create.
      const article = await readArticle(coll, slug);
      return { path: article.path, kind: 'article' };
    }
    return { path: entry.path, kind: 'collection' };
  }
  const cwdColl = await resolveCwdCollection(cwd);
  if (cwdColl) return { path: cwdColl.path, kind: 'collection' };
  return { path: collectionsDir(), kind: 'root' };
}

/**
 * Resolve the editor command argv used by `diffwiki edit`, in precedence order:
 * `--editor` flag → config `editor` → `$VISUAL` → `$EDITOR`. Returns undefined when
 * none is set (the caller prints guidance). The command is split on whitespace, so
 * simple flagged commands like `code -w` work; quoted arguments are not supported.
 */
export async function resolveEditorCommand(flag?: string): Promise<string[] | undefined> {
  const raw = flag ?? (await getConfigValue('editor')) ?? process.env.VISUAL ?? process.env.EDITOR;
  if (!raw || !raw.trim()) return undefined;
  return raw.trim().split(/\s+/);
}
