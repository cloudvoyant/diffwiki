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

/** Route context for an article being rendered — used to resolve relative links. */
export interface RenderContext {
  /** Collection name (first route segment). */
  coll: string;
  /** Article route slug (path within the collection, no extension), e.g. "a/b/deep". */
  slug: string;
  /**
   * True when the source file is a folder-index page (`<slug>/index.md`). Such a
   * page shares its route slug with the folder, so relative links must resolve
   * against the folder itself, not its parent. Defaults to false (leaf page).
   */
  isIndex?: boolean;
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
 * Any `#hash`/`?query` suffix is preserved. Hrefs that escape the collection
 * root, or that are absolute / protocol / pure-anchor, are left unchanged.
 */
function rehypeRewriteLinks(ctx: RenderContext) {
  // A folder-index page (`guide/index.md`, slug "guide") resolves relative links
  // against its own folder ("guide"); a leaf page (`guide.md`, slug "guide")
  // resolves against its parent (dirname -> ".").
  const slugDir = ctx.isIndex ? ctx.slug || '.' : path.posix.dirname(ctx.slug || '.');
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return;
      const raw = node.properties?.href;
      if (typeof raw !== 'string' || isNonRelativeHref(raw)) return;

      // Split off a trailing #hash or ?query so it survives the rewrite.
      const suffixMatch = /[#?].*$/.exec(raw);
      const suffix = suffixMatch ? suffixMatch[0] : '';
      const pathPart = suffix ? raw.slice(0, raw.length - suffix.length) : raw;
      if (pathPart === '') return; // bare "#frag" already handled, but be safe

      // Resolve relative to the article's directory, keeping it POSIX.
      const joined = path.posix.join(slugDir === '.' ? '' : slugDir, pathPart);
      const normalized = path.posix.normalize(joined);
      // Escapes the collection root — can't map to a route; leave as-is.
      if (normalized.startsWith('..')) return;

      // Strip extension, then drop a trailing index/readme (folder index page).
      let resolved = normalized.replace(/\.(mdx?)$/i, '');
      resolved = resolved.replace(/(^|\/)(index|readme)$/i, '$1');
      resolved = resolved.replace(/\/+$/, '').replace(/^\/+/, '');

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
 * contents, rewriting relative links to in-app routes via `ctx`.
 * Runs entirely server-side; the client mounts the HTML directly with
 * no `eval`/`new Function`, so it works under a strict CSP. Code is highlighted
 * here (dual github-light/github-dark via CSS variables); mermaid fences are
 * marked for client rendering.
 */
export async function renderArticle(body: string, ctx: RenderContext): Promise<RenderedArticle> {
  const toc: TocItem[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeCollectToc, toc)
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
  return { html: String(file), toc };
}
