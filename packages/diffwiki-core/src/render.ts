import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeShiki from '@shikijs/rehype';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import { toString as hastToString } from 'hast-util-to-string';
import type { Root, Element } from 'hast';
import type { TocItem } from './types';

export type { TocItem };

/**
 * Route context for an article being rendered — used both to rewrite relative
 * inter-page links into in-app routes and to resolve links to `coll/slug` graph
 * node ids.
 */
export interface RenderContext {
  /** Collection name (first route segment). */
  coll: string;
  /** Article route slug (path within the collection, no extension), e.g. "a/b/deep". */
  slug: string;
  /**
   * True for a directory index page: relative links resolve against the folder
   * (`slug`) itself, not its parent — so `./sub` from `guide/index.md` → `guide/sub`.
   */
  isIndex?: boolean;
  /**
   * Deployment base path (e.g. `/my-repo/`) stripped from absolute route links so
   * the collection segment resolves cleanly. Defaults to `DIFFWIKI_BASE`.
   */
  base?: string;
}

/** True for hrefs that must pass through untouched: empty, root-absolute, pure
 *  anchor/query, protocol-relative, or any `scheme:` URL (http, mailto, tel, …). */
function isNonRelativeHref(href: string): boolean {
  if (href === '') return true;
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) return true;
  if (href.startsWith('//')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/**
 * rehype plugin: rewrite relative links between wiki pages into in-app route
 * paths `/{coll}/{slug}`. A relative href is resolved against the current
 * article's slug directory, has its `.md`/`.mdx` extension stripped, and a
 * trailing `index`/`readme` segment dropped (folder index → folder route).
 * Any `#hash`/`?query` suffix is preserved. A link that escapes the collection
 * root by exactly one level targets a SIBLING collection (collections live side
 * by side) and is mapped to `/{other-collection}/{slug}`; deeper escapes, or
 * absolute / protocol / pure-anchor hrefs, are left unchanged.
 */
function rehypeRewriteLinks(ctx: RenderContext) {
  const slugDir = ctx.isIndex ? ctx.slug || '.' : path.posix.dirname(ctx.slug || '.');
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const raw = node.properties?.href;
      if (typeof raw !== 'string' || isNonRelativeHref(raw)) return;

      // Split off a trailing #hash/?query so it survives the rewrite.
      const suffixMatch = /[#?].*$/.exec(raw);
      const suffix = suffixMatch ? suffixMatch[0] : '';
      const pathPart = suffix ? raw.slice(0, raw.length - suffix.length) : raw;
      if (pathPart === '') return;

      const joined = path.posix.join(slugDir === '.' ? '' : slugDir, pathPart);
      const normalized = path.posix.normalize(joined);

      // Strip .md/.mdx, drop a trailing index/readme, then trim slashes.
      const toRoute = (p: string) =>
        p
          .replace(/\.(mdx?)$/i, '')
          .replace(/(^|\/)(index|readme)$/i, '$1')
          .replace(/\/+$/, '')
          .replace(/^\/+/, '');

      // One level above the collection root → a sibling collection:
      // `../devtools/qmd/x.md` → `/devtools/qmd/x`. Deeper escapes leave the wiki.
      if (normalized.startsWith('../')) {
        const sibling = normalized.slice(3);
        if (sibling === '' || sibling.startsWith('..')) return; // beyond the sibling-collection level
        node.properties = { ...node.properties, href: `/${toRoute(sibling)}${suffix}` };
        return;
      }
      if (normalized.startsWith('..')) return; // bare `..` — can't map to a route

      const resolved = toRoute(normalized);
      node.properties = {
        ...node.properties,
        href: `/${ctx.coll}${resolved ? `/${resolved}` : ''}${suffix}`,
      };
    });
  };
}

/** The result of rendering an article body to HTML. */
export interface RenderedArticle {
  /** Fully-rendered, Shiki-highlighted HTML — mounted directly on the client (no eval). */
  html: string;
  /** h2/h3 headings collected during render, in document order. */
  toc: TocItem[];
  /**
   * Internal outgoing links as `coll/slug` node ids, de-duplicated, in document
   * order. Only populated when a {@link RenderContext} is supplied; external
   * links, in-page anchors, and unresolvable targets are dropped.
   */
  links: string[];
}

/** Fence-tag aliases → Shiki language ids (so ```c#``` / ```c++``` / ```hs``` work). */
const LANG_ALIASES: Record<string, string> = {
  'c#': 'csharp',
  cs: 'csharp',
  'c++': 'cpp',
  cxx: 'cpp',
  hs: 'haskell',
  ex: 'elixir',
};

/** rehype plugin: collect h2/h3 headings (with their anchor id) into `toc`. */
function rehypeCollectToc(toc: TocItem[]) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'h2' && node.tagName !== 'h3') return;
      const id = node.properties?.id;
      if (!id) return;
      toc.push({ slug: String(id), text: hastToString(node), depth: node.tagName === 'h2' ? 2 : 3 });
    });
  };
}

/** True for links that leave the wiki (or are in-page anchors), so they are not graph edges. */
function isExternalHref(href: string): boolean {
  if (!href) return true;
  if (href.startsWith('#')) return true; // in-page anchor
  if (href.startsWith('//')) return true; // protocol-relative → external
  return /^[a-z][a-z0-9+.-]*:/i.test(href); // has a scheme (http:, https:, mailto:, tel:, …)
}

/**
 * Resolve an `<a href>` from an article body to an internal `coll/slug` node id,
 * or `null` if it is not an internal article link. Handles two shapes:
 *   - Route links: `/coll/slug` (optionally with a base prefix, `.html`, trailing
 *     slash, query, or hash) → `coll/slug`.
 *   - Relative file links: `./foo.md`, `../bar/baz.mdx`, `sibling` → resolved
 *     against the current article's directory to `coll/<resolved>`.
 * The result is NOT verified against real nodes here — `buildLinkGraph` drops
 * edges whose target is not a known node.
 */
function resolveHref(href: string, ctx: RenderContext): string | null {
  if (isExternalHref(href)) return null;

  // Strip query/hash and any `.md`/`.mdx`/`.html` extension and trailing slash.
  const clean = (p: string): string =>
    p
      .replace(/[?#].*$/, '')
      .replace(/\.(mdx?|html)$/i, '')
      .replace(/\/+$/, '');

  const target = clean(href);
  if (!target) return null;

  if (target.startsWith('/')) {
    // Absolute route link: strip the base prefix, then the remainder is `<coll>/<slug…>`.
    const base = ctx.base ?? process.env.DIFFWIKI_BASE ?? '';
    const baseSegs = base.split('/').filter(Boolean);
    let segs = target.split('/').filter(Boolean);
    if (baseSegs.length > 0 && baseSegs.every((b, i) => segs[i] === b)) {
      segs = segs.slice(baseSegs.length);
    }
    if (segs.length < 2) return null;
    return segs.join('/');
  }

  // Relative link — resolve against the article's directory (an index page's dir is
  // its whole slug; a leaf file's is the slug's parent).
  const dir = ctx.isIndex ? ctx.slug : ctx.slug.includes('/') ? ctx.slug.slice(0, ctx.slug.lastIndexOf('/')) : '';
  const baseSegs = dir ? dir.split('/') : [];
  const out = [...baseSegs];
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // Reject `..` that escapes the collection root rather than clamp to a sibling.
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  if (out.length === 0) return null;
  return `${ctx.coll}/${out.join('/')}`;
}

/** rehype plugin: collect internal outgoing links (as `coll/slug` node ids) into `links`. */
function rehypeCollectLinks(links: string[], ctx: RenderContext) {
  const seen = new Set<string>();
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;
      const id = resolveHref(href, ctx);
      if (!id || seen.has(id)) return;
      seen.add(id);
      links.push(id);
    });
  };
}

/** rehype plugin: remove the first h1 (the title is rendered from frontmatter). */
function rehypeStripLeadingH1() {
  return (tree: Root) => {
    let removed = false;
    visit(tree, 'element', (node: Element, index, parent) => {
      if (!removed && node.tagName === 'h1' && parent && index != null) {
        parent.children.splice(index, 1);
        removed = true;
        return [SKIP, index];
      }
    });
  };
}

/**
 * rehype plugin: turn ```mermaid fences into `<pre class="mermaid">…source…</pre>`
 * so Shiki skips them and the client renders them with mermaid.
 */
function rehypeMarkMermaid() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return;
      const code = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      const cls = (code?.properties?.className as string[] | undefined) ?? [];
      if (!code || !cls.includes('language-mermaid')) return;
      const source = hastToString(code);
      node.properties = { className: ['mermaid'] };
      node.children = [{ type: 'text', value: source }];
    });
  };
}

/**
 * Render an article body (markdown) to Shiki-highlighted HTML plus its table of
 * contents. Rewrites relative inter-page links to in-app routes and collects the
 * article's internal outgoing links (`coll/slug` node ids) for the knowledge graph.
 * Runs entirely server-side; the client mounts the HTML directly with no
 * `eval`/`new Function`, so it works under a strict CSP. Code is highlighted here
 * (dual github-light/github-dark via CSS variables); mermaid fences are marked for
 * client rendering.
 */
export async function renderArticle(body: string, ctx: RenderContext): Promise<RenderedArticle> {
  const toc: TocItem[] = [];
  const links: string[] = [];
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeCollectToc, toc)
    .use(rehypeCollectLinks, links, ctx);
  const file = await pipeline
    .use(rehypeStripLeadingH1)
    .use(rehypeMarkMermaid)
    .use(rehypeRewriteLinks, ctx)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      langAlias: LANG_ALIASES,
      fallbackLanguage: 'plaintext',
    })
    .use(rehypeStringify)
    .process(body);
  return { html: String(file), toc, links };
}
