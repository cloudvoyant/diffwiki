import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify, parseDocument } from 'yaml';
import { metaDir } from './paths';
import { DiffwikiError, InvalidTargetError } from './errors';
import type { CollectionEntry } from './types';

export const META_KINDS = ['history', 'external-source-extract', 'dream-learning'] as const;
export type MetaKind = (typeof META_KINDS)[number];
type Collection = Pick<CollectionEntry, 'name' | 'path'>;
export interface MetaResult {
  created: string[];
  kept: string[];
  index_paths: string[];
  warnings: string[];
  errors: string[];
}
export interface MetaRecordResult {
  id: string;
  path: string;
  target: string;
  mirror_path?: string;
  index_paths: string[];
}

const START = '<!-- diffwiki:meta:start -->';
const END = '<!-- diffwiki:meta:end -->';
const within = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';

function collectionRoot(name: string): string {
  if (!name || name.startsWith('.') || /[/\\\0]/.test(name) || name.toLowerCase() === 'meta.md') {
    throw new InvalidTargetError(name, 'expected a collection name without path segments or reserved names');
  }
  return path.resolve(metaDir(), name);
}

/** Exact file identity; unlike article titles, this must never be slugified. */
export function validateMetaArticlePath(file: string): string {
  if (
    !/\.mdx?$/i.test(file) ||
    path.isAbsolute(file) ||
    /[\\\0]/.test(file) ||
    file.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
  ) {
    throw new InvalidTargetError(file, 'expected an exact relative .md/.mdx file path without traversal');
  }
  return file;
}

/** Reject symlinks inside the metadata store before reading or replacing files. */
async function checked(file: string): Promise<string> {
  const root = path.resolve(metaDir());
  const absolute = path.resolve(file);
  if (!within(root, absolute)) throw new InvalidTargetError(file, 'path escapes the metadata root');
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of ['', ...parts]) {
    current = part ? path.join(current, part) : current;
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new DiffwikiError(`metadata path is a symlink: ${current}`);
    } catch (err) {
      if (missing(err)) break;
      throw err;
    }
  }
  return absolute;
}

async function seed(file: string, title: string): Promise<boolean> {
  await checked(file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, `# ${title}\n\n${START}\nNo source history captured.\n${END}\n`, { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

async function listing(file: string, title: string, lines: string[]): Promise<void> {
  await seed(file, title);
  const raw = await fs.readFile(await checked(file), 'utf8');
  const block = `${START}\n${lines.length ? lines.join('\n') : 'No source history captured.'}\n${END}`;
  const start = raw.indexOf(START);
  const end = raw.indexOf(END, start);
  if (start >= 0 !== end >= 0) throw new DiffwikiError(`incomplete generated section in ${file}`);
  const next = start >= 0 ? raw.slice(0, start) + block + raw.slice(end + END.length) : `${raw}\n${block}\n`;
  if (next === raw) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(await checked(temporary), next, { flag: 'wx' });
    await checked(file);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function link(from: string, to: string, label: string): string {
  const href = path.relative(path.dirname(from), to).split(path.sep).map(encodeURIComponent).join('/');
  return `[${label
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/[\r\n]/g, '')}](${href})`;
}

async function markdownFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const item of (await fs.readdir(path.join(root, rel), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (item.name.startsWith('.')) continue;
    const file = rel ? `${rel}/${item.name}` : item.name;
    if (item.isDirectory()) out.push(...(await markdownFiles(root, file)));
    else if (item.isFile() && /\.mdx?$/i.test(file)) out.push(file);
  }
  return out;
}

async function globalIndex(): Promise<string> {
  await fs.mkdir(await checked(metaDir()), { recursive: true });
  const index = path.join(metaDir(), 'META.md');
  const lines: string[] = [];
  for (const item of (await fs.readdir(metaDir(), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const collectionIndex = path.join(collectionRoot(item.name), '.meta', 'META.md');
    try {
      await fs.access(await checked(collectionIndex));
      lines.push(`- ${link(index, collectionIndex, item.name)}`);
    } catch (err) {
      if (!missing(err)) throw err;
    }
  }
  await listing(index, 'Source collections', lines);
  return index;
}

export async function ensureCollectionMeta(entry: Collection): Promise<string> {
  const root = collectionRoot(entry.name);
  const source = path.resolve(entry.path);
  if (within(source, path.resolve(metaDir())) || within(path.resolve(metaDir()), source)) {
    throw new InvalidTargetError(entry.path, 'collection content overlaps the metadata store');
  }
  const index = path.join(root, '.meta', 'META.md');
  await seed(index, `Sources for ${entry.name}`);
  await globalIndex();
  return index;
}

export async function ensureArticleMeta(entry: Collection, articlePath: string): Promise<string> {
  const relative = validateMetaArticlePath(articlePath);
  await ensureCollectionMeta(entry);
  const mirror = path.join(collectionRoot(entry.name), relative);
  if (await seed(mirror, `Sources for ${entry.name}:${relative}`)) await reindexMeta(entry.name);
  return mirror;
}

/** A successful article write must remain visible when its mirror cannot be saved. */
export async function mirrorSavedArticle(entry: Collection, file: string): Promise<void> {
  try {
    await ensureArticleMeta(entry, path.relative(entry.path, file).split(path.sep).join('/'));
  } catch (err) {
    throw new DiffwikiError(
      `Article saved at ${file}, but metadata setup failed: ${String(err)}. Repair with: diffwiki meta init ${entry.name}`,
    );
  }
}

/** Rebuild only generated listings. Raw records are ordinary user-editable files. */
export async function reindexMeta(collection?: string): Promise<MetaResult> {
  await fs.mkdir(await checked(metaDir()), { recursive: true });
  const result: MetaResult = { created: [], kept: [], index_paths: [], warnings: [], errors: [] };
  const names = collection
    ? [collection]
    : (await fs.readdir(metaDir(), { withFileTypes: true }))
        .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
        .map((item) => item.name)
        .sort();
  for (const name of names) {
    try {
      const root = await checked(collectionRoot(name));
      const index = path.join(root, '.meta', 'META.md');
      await fs.access(await checked(index));
      const pages = await markdownFiles(root);
      const recordDir = await checked(path.join(root, '.meta', 'records'));
      let records: string[] = [];
      try {
        records = (await fs.readdir(recordDir)).filter((file) => file.endsWith('.md')).sort();
      } catch (err) {
        if (!missing(err)) throw err;
      }
      const pageLines = new Map(pages.map((file) => [file, [] as string[]]));
      const sourceLines: string[] = [];
      const dreamLines: string[] = [];
      for (const record of records) {
        const file = await checked(path.join(recordDir, record));
        try {
          const raw = await fs.readFile(file, 'utf8');
          const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
          if (!front) throw new Error('missing record header');
          const doc = parseDocument(front[1]);
          if (doc.errors.length) throw new Error('invalid YAML header');
          const data = doc.toJS() as Record<string, unknown>;
          if (
            !data ||
            !META_KINDS.includes(data.kind as MetaKind) ||
            data.collection !== name ||
            typeof data.captured_at !== 'string'
          ) {
            throw new Error('invalid kind, collection, or capture time');
          }
          const article =
            data.article_path === undefined ? undefined : validateMetaArticlePath(String(data.article_path));
          const label = `${data.kind} · ${record.replace(/\.md$/, '')}`;
          const bucket = data.kind === 'dream-learning' ? dreamLines : sourceLines;
          bucket.push(`- ${link(index, file, label)}${article ? ` — \`${article}\`` : ' — collection'}`);
          if (article) {
            if (!pageLines.has(article))
              result.warnings.push(`${file}: no manifest for ${article}; run meta init if the article exists`);
            else pageLines.get(article)!.push(`- ${link(path.join(root, article), file, label)}`);
          }
        } catch (err) {
          result.warnings.push(`${file}: ${String(err)}`);
        }
      }
      for (const [page, lines] of pageLines) {
        const file = path.join(root, page);
        await listing(file, `Sources for ${name}:${page}`, [
          `Collection: ${link(file, index, 'collection sources')}`,
          '',
          ...(lines.length ? lines : ['No page source history captured.']),
        ]);
      }
      await listing(index, `Sources for ${name}`, [
        '## Raw sources',
        '',
        ...(sourceLines.length ? sourceLines : ['No raw sources captured.']),
        '',
        '## Dream learnings',
        '',
        ...(dreamLines.length ? dreamLines : ['No dream learnings captured.']),
        '',
        '## Pages',
        '',
        ...pages.map((page) => `- ${link(index, path.join(root, page), page)}`),
      ]);
      result.index_paths.push(index);
    } catch (err) {
      result.errors.push(`${name}: ${String(err)}`);
    }
  }
  result.index_paths.push(await globalIndex());
  return result;
}

export async function initMeta(entries: Collection[]): Promise<MetaResult> {
  const result: MetaResult = { created: [], kept: [], index_paths: [], warnings: [], errors: [] };
  for (const entry of entries) {
    try {
      // Read first so an unreadable root is never mistaken for an empty collection.
      const files = await markdownFiles(entry.path);
      await ensureCollectionMeta(entry);
      for (const file of files) {
        const mirror = path.join(collectionRoot(entry.name), validateMetaArticlePath(file));
        ((await seed(mirror, `Sources for ${entry.name}:${file}`)) ? result.created : result.kept).push(mirror);
      }
      const indexed = await reindexMeta(entry.name);
      result.index_paths.push(...indexed.index_paths);
      result.warnings.push(...indexed.warnings);
      result.errors.push(...indexed.errors);
    } catch (err) {
      result.errors.push(`${entry.name}: ${String(err)}`);
    }
  }
  if (!entries.length) result.index_paths.push(await globalIndex());
  result.index_paths = [...new Set(result.index_paths)];
  return result;
}

export async function createMetaRecord(
  entry: Collection,
  articlePath: string | undefined,
  kind: MetaKind,
  body: string,
): Promise<MetaRecordResult> {
  if (!META_KINDS.includes(kind)) throw new InvalidTargetError(kind, 'unknown metadata template');
  let mirror: string | undefined;
  if (articlePath !== undefined) {
    validateMetaArticlePath(articlePath);
    const sourceRoot = await fs.realpath(entry.path);
    const source = await fs.realpath(path.resolve(entry.path, articlePath));
    if (!within(sourceRoot, source) || !(await fs.stat(source)).isFile()) {
      throw new InvalidTargetError(articlePath, 'article must be a file within its collection');
    }
    mirror = await ensureArticleMeta(entry, articlePath);
  } else await ensureCollectionMeta(entry);
  const capturedAt = new Date().toISOString();
  const id = `${capturedAt.replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
  const file = await checked(path.join(collectionRoot(entry.name), '.meta', 'records', `${id}.md`));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const header = {
    kind,
    collection: entry.name,
    ...(articlePath ? { article_path: articlePath } : {}),
    captured_at: capturedAt,
  };
  await fs.writeFile(file, `---\n${stringify(header)}---\n${body}`, { flag: 'wx' });
  const indexed = await reindexMeta(entry.name);
  if (indexed.errors.length)
    throw new DiffwikiError(
      `Record saved at ${file}, but indexing failed: ${indexed.errors.join('; ')}. Repair with: diffwiki meta reindex ${entry.name}`,
    );
  return {
    id,
    path: file,
    target: articlePath ? `${entry.name}:${articlePath}` : entry.name,
    ...(mirror ? { mirror_path: mirror } : {}),
    index_paths: indexed.index_paths,
  };
}
