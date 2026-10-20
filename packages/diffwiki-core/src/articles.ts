import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './config';
import { findCollection } from './collections';
import { slugifyPath } from './slugify';
import { parseArticle, serializeArticle, patchArticle } from './frontmatter';
import { mirrorSavedArticle, validateMetaArticlePath } from './meta';
import { ArticleNotFoundError, CollectionNotFoundError, InvalidTargetError, NoDefaultCollectionError } from './errors';
import type { Article, Audience, PluginEvent, PublishStatus } from './types';

/**
 * Fire a lifecycle hook without adding a static import edge into the plugin
 * loader graph (which would create a `collections <-> events` cycle). The dynamic
 * import resolves lazily and the whole call is swallowed -- hooks are best-effort.
 * Callers invoke this fire-and-forget: `void fireHook(...)`.
 */
async function fireHook(event: PluginEvent, collection: string, relPath?: string): Promise<void> {
  try {
    const { emitPluginEvent } = await import('./plugins/events');
    await emitPluginEvent(event, collection, relPath);
  } catch {
    /* never let a hook failure surface into a mutation */
  }
}

/** Parse "[collection:]title" (collection optional) for `add`. */
export function parseAddTarget(target: string): { collection?: string; title: string } {
  const idx = target.indexOf(':');
  if (idx === -1) {
    const title = target.trim();
    if (!title) throw new InvalidTargetError(target, 'expected "[collection:]title"');
    return { title };
  }
  const collection = target.slice(0, idx).trim();
  const title = target.slice(idx + 1).trim();
  if (!title) throw new InvalidTargetError(target, 'expected "[collection:]title"');
  return collection ? { collection, title } : { title };
}

/** Parse "collection:path" (both required) for update/remove/tags. */
export function parsePathTarget(target: string): { collection: string; file: string } {
  const idx = target.indexOf(':');
  if (idx === -1) throw new InvalidTargetError(target, 'expected "collection:path"');
  const collection = target.slice(0, idx).trim();
  const file = target.slice(idx + 1).trim();
  if (!collection || !file) throw new InvalidTargetError(target, 'expected "collection:path"');
  return { collection, file };
}

async function resolveCollectionDir(name: string | undefined): Promise<{ name: string; dir: string }> {
  let coll = name;
  if (!coll) {
    coll = (await readConfig()).defaultCollection;
    if (!coll) throw new NoDefaultCollectionError();
  }
  const entry = await findCollection(coll);
  if (!entry) throw new CollectionNotFoundError(coll);
  return { name: coll, dir: entry.path };
}

/**
 * Resolve the `-p "coll:path"` segment to a filename. `create` writes files by
 * `slugifyPath(title)`, so a lookup passed the original title (e.g. "My Project/My Title")
 * must slugify EVERY segment to match (`my-project/my-title.md`) — not just the
 * basename. An explicit `.md`/`.mdx` path is already resolved and preserved as-is.
 */
function ensureMdPath(file: string): string {
  if (/\.mdx?$/.test(file)) return file;
  return `${slugifyPath(file)}.md`;
}

export async function createArticle(opts: {
  target: string;
  tags: string[];
  body?: string;
  audience?: Audience;
  status?: PublishStatus;
}): Promise<Article> {
  const { collection, title } = parseAddTarget(opts.target);
  const { name, dir } = await resolveCollectionDir(collection);
  const filePath = path.join(dir, `${slugifyPath(title)}.md`);
  const body = opts.body ?? `# ${title}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    serializeArticle({ title, tags: opts.tags, body, audience: opts.audience, status: opts.status }),
    'utf8',
  );
  void fireHook('article-created', name, path.relative(dir, filePath));
  await mirrorSavedArticle({ name, path: dir }, filePath);
  return { title, tags: opts.tags, path: filePath, collection: name };
}

async function loadArticle(
  target: string,
): Promise<{ filePath: string; dir: string; raw: string; collection: string }> {
  const { collection, file } = parsePathTarget(target);
  const { dir } = await resolveCollectionDir(collection);
  const filePath = path.join(dir, validateMetaArticlePath(ensureMdPath(file)));
  try {
    return { filePath, dir, raw: await fs.readFile(filePath, 'utf8'), collection };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ArticleNotFoundError(target);
    throw err;
  }
}

export interface ArticleUpdates {
  title?: string;
  body?: string;
  tags?: string[];
  audience?: Audience;
  status?: PublishStatus;
}

/** Compose requested edits once so title/body/meta combinations retain unrelated fields. */
export async function updateArticle(target: string, updates: ArticleUpdates): Promise<Article> {
  const { filePath, dir, raw, collection } = await loadArticle(target);
  if (updates.title !== undefined && !updates.title.trim())
    throw new InvalidTargetError(updates.title, 'title cannot be empty');
  const fields: Record<string, unknown> = {};
  if (updates.title !== undefined) fields.title = updates.title;
  if (updates.tags !== undefined) fields.tags = Array.from(new Set(updates.tags));
  if (updates.audience !== undefined) fields.audience = updates.audience === 'public' ? undefined : updates.audience;
  if (updates.status !== undefined) fields.status = updates.status === 'published' ? undefined : updates.status;
  const next = patchArticle(raw, fields, updates.body);
  await fs.writeFile(filePath, next, 'utf8');
  const parsed = parseArticle(next);
  void fireHook('article-updated', collection, path.relative(dir, filePath));
  await mirrorSavedArticle({ name: collection, path: dir }, filePath);
  return { title: parsed.title, tags: parsed.tags, path: filePath, collection };
}

export function updateArticleBody(target: string, body: string): Promise<Article> {
  return updateArticle(target, { body });
}

async function mutateTags(target: string, fn: (tags: string[]) => string[]): Promise<Article> {
  const { raw } = await loadArticle(target);
  const parsed = parseArticle(raw);
  return updateArticle(target, { tags: fn(parsed.tags) });
}

export function addTags(target: string, tags: string[]): Promise<Article> {
  return mutateTags(target, (current) => Array.from(new Set([...current, ...tags])));
}

export function removeTags(target: string, tags: string[]): Promise<Article> {
  const drop = new Set(tags);
  return mutateTags(target, (current) => current.filter((t) => !drop.has(t)));
}

export function setTags(target: string, tags: string[]): Promise<Article> {
  return mutateTags(target, () => Array.from(new Set(tags)));
}

/**
 * Set an article's audience and/or status. Unspecified axes are left as-is; the
 * writer drops frontmatter for default values (public/published), so setting
 * an axis back to its default cleans it out of the file.
 */
export async function setArticleMeta(
  target: string,
  meta: { audience?: Audience; status?: PublishStatus },
): Promise<Article> {
  return updateArticle(target, meta);
}

export async function removeArticle(target: string): Promise<string> {
  const { filePath, dir, collection } = await loadArticle(target);
  await fs.rm(filePath);
  void fireHook('article-removed', collection, path.relative(dir, filePath));
  return filePath;
}
