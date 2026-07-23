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
 * contents. Runs entirely server-side; the client mounts the HTML directly with
 * no `eval`/`new Function`, so it works under a strict CSP. Code is highlighted
 * here (dual github-light/github-dark via CSS variables); mermaid fences are
 * marked for client rendering.
 */
export async function renderArticle(body: string): Promise<RenderedArticle> {
  const toc: TocItem[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeCollectToc, toc)
    .use(rehypeStripLeadingH1)
    .use(rehypeMarkMermaid)
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
