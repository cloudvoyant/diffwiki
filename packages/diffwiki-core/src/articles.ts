import fs from 'node:fs/promises';
import path from 'node:path';
import { readConfig } from './config';
import { findCollection } from './collections';
import { slugify } from './slugify';
import { parseArticle, serializeArticle } from './frontmatter';
import { ArticleNotFoundError, CollectionNotFoundError, InvalidTargetError, NoDefaultCollectionError } from './errors';
import type { Article } from './types';

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
 * Resolve the `-p "coll:path"` segment to a filename. `add` writes files by
 * `slugify(title)`, so a lookup passed the original title (e.g. "My Title")
 * must slugify to match (`my-title.md`). An already-slugified path or one with an
 * explicit `.md`/`.mdx` extension is preserved as-is.
 */
function ensureMdPath(file: string): string {
  if (/\.mdx?$/.test(file)) return file;
  const dir = path.dirname(file);
  const base = slugify(path.basename(file));
  const rel = dir === '.' ? `${base}.md` : path.join(dir, `${base}.md`);
  return rel;
}

export async function createArticle(opts: { target: string; tags: string[]; body?: string }): Promise<Article> {
  const { collection, title } = parseAddTarget(opts.target);
  const { name, dir } = await resolveCollectionDir(collection);
  const filePath = path.join(dir, `${slugify(title)}.md`);
  const now = new Date().toISOString();
  const body = opts.body ?? `# ${title}\n`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, serializeArticle({ title, tags: opts.tags, created: now, updated: now, body }), 'utf8');
  return { title, tags: opts.tags, path: filePath, collection: name };
}

async function loadArticle(target: string): Promise<{ filePath: string; raw: string; collection: string }> {
  const { collection, file } = parsePathTarget(target);
  const { dir } = await resolveCollectionDir(collection);
  const filePath = path.join(dir, ensureMdPath(file));
  try {
    return { filePath, raw: await fs.readFile(filePath, 'utf8'), collection };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ArticleNotFoundError(target);
    throw err;
  }
}

export async function updateArticleBody(target: string, body: string): Promise<Article> {
  const { filePath, raw, collection } = await loadArticle(target);
  const parsed = parseArticle(raw);
  await fs.writeFile(
    filePath,
    serializeArticle({
      title: parsed.title,
      tags: parsed.tags,
      created: parsed.created,
      updated: new Date().toISOString(),
      body,
    }),
    'utf8',
  );
  return { title: parsed.title, tags: parsed.tags, path: filePath, collection };
}

async function mutateTags(target: string, fn: (tags: string[]) => string[]): Promise<Article> {
  const { filePath, raw, collection } = await loadArticle(target);
  const parsed = parseArticle(raw);
  const tags = fn(parsed.tags);
  await fs.writeFile(
    filePath,
    serializeArticle({
      title: parsed.title,
      tags,
      created: parsed.created,
      updated: new Date().toISOString(),
      body: parsed.body,
    }),
    'utf8',
  );
  return { title: parsed.title, tags, path: filePath, collection };
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

export async function removeArticle(target: string): Promise<string> {
  const { filePath } = await loadArticle(target);
  await fs.rm(filePath);
  return filePath;
}
