import fs from 'node:fs/promises';
import path from 'node:path';
import { findCollection } from './collections';
import { parseArticle } from './frontmatter';
import { ArticleNotFoundError, CollectionNotFoundError, InvalidTargetError } from './errors';
import type { ArticleNode, ArticleContent, Audience, PublishStatus } from './types';

// ── Pure tree builder (unit-tested) ─────────────────────────────────────────

type Trie = { [seg: string]: Trie | null }; // null = leaf sentinel

/** Files that serve as a folder's/collection's index page (not listed as articles). */
const INDEX_RE = /^(index|readme)\.mdx?$/i;

/**
 * Build a nested ArticleNode[] from a flat list of relative file paths.
 * Pure — no I/O. Directories become branches; files become leaves whose `slug`
 * is the relative path without extension. Dirs-first, then alpha (case-insensitive).
 */
export function buildArticleTree(relPaths: string[]): ArticleNode[] {
  const root: Trie = {};
  for (const raw of relPaths) {
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel) continue;
    const segs = rel.split('/');
    let cur: Trie = root;
    segs.forEach((seg, i) => {
      if (i === segs.length - 1) {
        if (!(seg in cur)) cur[seg] = null;
      } else {
        if (cur[seg] === null || !(seg in cur)) cur[seg] = {};
        cur = cur[seg] as Trie;
      }
    });
  }

  const stripExt = (f: string) => f.replace(/\.(mdx?)$/, '');

  const walk = (trie: Trie, parents: string[]): ArticleNode[] => {
    const entries = Object.entries(trie);
    const branches = entries.filter(([, v]) => v !== null) as [string, Trie][];
    // Drop index/README files — they are the folder's own index page, not a
    // separately-listed article.
    const leaves = entries
      .filter(([, v]) => v === null)
      .map(([k]) => k)
      .filter((f) => !INDEX_RE.test(f));
    branches.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
    leaves.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const branchNodes: ArticleNode[] = branches.map(([seg, sub]) => ({
      name: seg,
      title: seg,
      // Folders are navigable to their index page (an authored index.md/README,
      // else a generated listing).
      slug: [...parents, seg].join('/'),
      children: walk(sub, [...parents, seg]),
    }));
    const leafNodes: ArticleNode[] = leaves.map((file) => {
      const nameNoExt = stripExt(file);
      return { name: nameNoExt, title: nameNoExt, slug: [...parents, nameNoExt].join('/') };
    });
    return [...branchNodes, ...leafNodes];
  };

  return walk(root, []);
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

/** Recursively collect `.md`/`.mdx` paths relative to `dir` (hidden entries skipped). */
async function collectRelPaths(dir: string, rel = ''): Promise<string[]> {
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) {
      out.push(...(await collectRelPaths(path.join(dir, d.name), childRel)));
    } else if (/\.(mdx?)$/.test(d.name)) {
      out.push(childRel);
    }
  }
  return out;
}

/** List a directory's entries, returning [] if it can't be read. */
async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** Pick a directory's index file — index.* over README.*, .mdx over .md — case-insensitive. */
function pickIndexFile(names: string[]): string | undefined {
  const rank = (n: string): number => {
    const lower = n.toLowerCase();
    const base = lower.startsWith('index') ? 0 : 1; // index before readme
    const ext = lower.endsWith('.mdx') ? 0 : 1; // mdx before md
    return base * 2 + ext;
  };
  return names.filter((n) => INDEX_RE.test(n)).sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Read the leading bytes of a file and extract YAML frontmatter title/audience/status.
 * Reads up to 8 KiB so a long frontmatter block's closing `---` (and any late
 * `audience:`/`status:` line) isn't truncated — a miss there is a visibility bug
 * (a private/draft page could leak into a static export), not just a wrong title.
 */
const CHEAP_META_BYTES = 8192;
async function cheapMeta(
  absPath: string,
): Promise<{ title?: string; audience?: Audience; status?: PublishStatus; order?: number }> {
  let handle: import('node:fs/promises').FileHandle | undefined;
  try {
    handle = await fs.open(absPath, 'r');
    const buf = Buffer.alloc(CHEAP_META_BYTES);
    const { bytesRead } = await handle.read(buf, 0, CHEAP_META_BYTES, 0);
    const snippet = buf.subarray(0, bytesRead).toString('utf8');
    // Only look inside a leading frontmatter fence.
    const fence = /^---[ \t]*\n([\s\S]*?)(?:\n---[ \t]*\n|$)/.exec(snippet);
    if (!fence) return {};
    const inner = fence[1];
    const clean = (s: string) => s.trim().replace(/^["']|["']$/g, '');
    const titleM = /^title:\s*(.+)$/m.exec(inner);
    const audienceM = /^audience:\s*(.+)$/m.exec(inner);
    const statusM = /^status:\s*(.+)$/m.exec(inner);
    const orderM = /^order:\s*(.+)$/m.exec(inner);
    const title = titleM ? clean(titleM[1]) : undefined;
    // Only the non-default value of each axis is carried (private / draft).
    const audience = audienceM && clean(audienceM[1]) === 'private' ? ('private' as const) : undefined;
    const status = statusM && clean(statusM[1]) === 'draft' ? ('draft' as const) : undefined;
    const orderNum = orderM ? Number(clean(orderM[1])) : NaN;
    const order = Number.isFinite(orderNum) ? orderNum : undefined;
    return { title, audience, status, order };
  } catch {
    /* unreadable — fall back to filename */
  } finally {
    await handle?.close();
  }
  return {};
}

/**
 * Enrich leaf/folder titles + status + order from frontmatter (cheap partial read),
 * then sort each sibling set by frontmatter `order` (ascending; unset sorts after,
 * keeping the dirs-first, alphabetical order from `buildArticleTree` as the tiebreak
 * via a stable sort). Returns a new tree.
 */
async function enrichTitles(nodes: ArticleNode[], collDir: string): Promise<ArticleNode[]> {
  const enriched = await Promise.all(
    nodes.map(async (node): Promise<ArticleNode> => {
      if (node.children) {
        const children = await enrichTitles(node.children, collDir);
        // A folder shows the title (and audience/status/order) of its index page, when one exists.
        let title = node.title;
        let audience = node.audience;
        let status = node.status;
        let order = node.order;
        if (node.slug) {
          const dir = path.join(collDir, node.slug);
          const idx = pickIndexFile(await readdirSafe(dir));
          if (idx) {
            const meta = await cheapMeta(path.join(dir, idx));
            title = meta.title ?? title;
            audience = meta.audience ?? audience;
            status = meta.status ?? status;
            order = meta.order ?? order;
          }
        }
        return { ...node, title, audience, status, order, children };
      }
      for (const ext of ['.mdx', '.md']) {
        const meta = await cheapMeta(path.join(collDir, `${node.slug}${ext}`));
        if (meta.title || meta.audience || meta.status || meta.order != null) {
          return {
            ...node,
            title: meta.title ?? node.title,
            audience: meta.audience ?? node.audience,
            status: meta.status ?? node.status,
            order: meta.order ?? node.order,
          };
        }
      }
      return node;
    }),
  );
  // Array.prototype.sort is stable, so unordered siblings keep their dirs-first/alpha order.
  return enriched.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read a collection's (or any directory's) audience + status from its index page
 * (index.md / README). Each axis is present only at its non-default value
 * (audience:'private' / status:'draft'), else absent. Cheap partial read — used
 * to mark/skip whole collections the same way leaf articles are.
 */
export async function collectionMeta(
  collDir: string,
): Promise<{ title?: string; audience?: Audience; status?: PublishStatus }> {
  const idx = pickIndexFile(await readdirSafe(collDir));
  if (!idx) return {};
  const meta = await cheapMeta(path.join(collDir, idx));
  return { title: meta.title, audience: meta.audience, status: meta.status };
}

/**
 * List the article tree of a collection. Walks the collection's registered
 * `entry.path` — so collections living OUTSIDE `~/.diffwiki/collections`
 * (e.g. in-repo wikis registered via `diffwiki init`) work unchanged.
 */
export async function listArticleTree(coll: string): Promise<ArticleNode[]> {
  const entry = await findCollection(coll);
  if (!entry) throw new CollectionNotFoundError(coll);
  const rels = await collectRelPaths(entry.path);
  return enrichTitles(buildArticleTree(rels), path.resolve(entry.path));
}

/**
 * Read and resolve a single article by collection + slug (relative path without
 * extension). Tries `.mdx` then `.md`, guards against path traversal, and splits
 * frontmatter. Throws CollectionNotFoundError / ArticleNotFoundError / InvalidTargetError.
 */
export async function readArticle(coll: string, slug: string): Promise<ArticleContent> {
  const entry = await findCollection(coll);
  if (!entry) throw new CollectionNotFoundError(coll);
  const collDir = path.resolve(entry.path);

  const normalized = slug.replace(/\\/g, '/');
  // Reject any path that contains traversal segments before sanitising.
  if (normalized.split('/').some((s) => s === '..')) {
    throw new InvalidTargetError(slug, 'path traversal detected');
  }
  const safeSlug = normalized
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .join('/');

  const inJail = (p: string) => p === collDir || p.startsWith(collDir + path.sep);

  // Resolution order: the file itself (.mdx then .md), then the directory's
  // index page. An empty slug resolves the collection-root index.
  let abs: string | undefined;
  let isIndex = false;
  for (const rel of safeSlug ? [`${safeSlug}.mdx`, `${safeSlug}.md`] : []) {
    const candidate = path.resolve(collDir, rel);
    if (!inJail(candidate)) throw new InvalidTargetError(slug, 'path traversal detected');
    try {
      await fs.access(candidate);
      abs = candidate;
      break;
    } catch {
      /* try next candidate */
    }
  }

  // Directory index — matched case-insensitively so it stays consistent with the
  // tree builder (INDEX_RE), which drops index/README leaves regardless of case.
  if (!abs) {
    const dir = path.resolve(collDir, safeSlug);
    if (inJail(dir)) {
      const idx = pickIndexFile(await readdirSafe(dir));
      if (idx) {
        abs = path.join(dir, idx);
        isIndex = true;
      }
    }
  }
  if (!abs) throw new ArticleNotFoundError(`${coll}/${safeSlug}`);

  const parsed = parseArticle(await fs.readFile(abs, 'utf8'));
  const title = parsed.title?.trim() || (safeSlug ? (safeSlug.split('/').pop() ?? safeSlug) : coll);
  return {
    coll,
    slug: safeSlug,
    title,
    tags: parsed.tags,
    audience: parsed.audience,
    status: parsed.status,
    body: parsed.body,
    path: abs,
    isIndex,
  };
}
