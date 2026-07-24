import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';

/**
 * Renders an article whose body was turned into Shiki-highlighted HTML on the
 * server (diffwiki-core `renderArticle`). The HTML is mounted directly — no
 * `run()`/`eval`, so it works under a strict CSP. A client effect progressively
 * enhances it: a copy button per code block, and mermaid rendering for
 * `pre.mermaid` blocks (mermaid itself still uses eval, so diagrams are the one
 * piece that a strict CSP can block — code and prose are unaffected).
 *
 * The effect also intercepts clicks on internal in-content links (`/coll/slug…`)
 * and routes them through the router for client-side, basepath-aware navigation;
 * same-page `#fragment` links scroll in place instead of navigating.
 */
export function ArticleBody({ html }: { html: string }) {
  const ref = useRef<HTMLElement>(null);
  const router = useRouter();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    addCopyButtons(root);

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      if (anchor.target || anchor.hasAttribute('download') || anchor.getAttribute('rel') === 'external') return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      const [linkPath, linkHash] = href.split('#');
      // Rewritten hrefs are base-agnostic; location.pathname carries the basepath — strip it to compare.
      const base = router.basepath?.replace(/\/$/, '') ?? '';
      const rawPath = window.location.pathname;
      const currentPath = base && rawPath.startsWith(base) ? rawPath.slice(base.length) || '/' : rawPath;
      if (linkHash !== undefined && linkPath.split('?')[0] === currentPath) {
        // Same-page #fragment: scroll in place, keeping the basepath in the URL bar.
        event.preventDefault();
        const el = linkHash ? document.getElementById(decodeURIComponent(linkHash)) : null;
        if (el) el.scrollIntoView();
        else window.scrollTo({ top: 0 });
        history.replaceState(null, '', `${base}${href}`);
        return;
      }
      event.preventDefault();
      void router.navigate({ to: href });
    };
    root.addEventListener('click', onClick, true);

    let cancelled = false;
    const isCancelled = () => cancelled;
    const paint = () => {
      if (!cancelled) void renderMermaid(root, document.documentElement.classList.contains('dark'), isCancelled);
    };
    paint();

    // Re-render mermaid when the .dark class toggles on <html>.
    const observer = new MutationObserver(() => paint());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      cancelled = true;
      root.removeEventListener('click', onClick, true);
      observer.disconnect();
    };
  }, [html, router]);

  return (
    <article ref={ref} className="prose dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** Wrap each Shiki code block and add a copy-to-clipboard button (DOM only, no eval). */
function addCopyButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLPreElement>('pre.shiki').forEach((pre) => {
    if (pre.parentElement?.classList.contains('code-wrap')) return; // already enhanced
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap not-prose';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent ?? '');
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 1500);
      } catch {
        /* clipboard unavailable — ignore */
      }
    });
    wrap.appendChild(btn);
  });
}

const MERMAID_VARS_DARK = {
  primaryColor: '#2d2d2d',
  primaryTextColor: '#f5f5f5',
  primaryBorderColor: '#555555',
  lineColor: '#aaaaaa',
  secondaryColor: '#1a1a1a',
  tertiaryColor: '#3a3a3a',
  background: '#1e1e1e',
  mainBkg: '#2d2d2d',
  nodeBorder: '#555555',
};
const MERMAID_VARS_LIGHT = {
  primaryColor: '#f4f4f4',
  primaryTextColor: '#111111',
  primaryBorderColor: '#cccccc',
  lineColor: '#777777',
  secondaryColor: '#eeeeee',
  tertiaryColor: '#ffffff',
  background: '#ffffff',
  mainBkg: '#f4f4f4',
  nodeBorder: '#cccccc',
};

let mermaidSeq = 0;

/** Render (and re-render on theme toggle) mermaid blocks. mermaid is dynamically
 *  imported so it never touches the SSR/initial bundle. `isCancelled` lets an
 *  unmount/navigation abort mid-flight so we don't mutate a detached tree. */
async function renderMermaid(root: HTMLElement, dark: boolean, isCancelled: () => boolean): Promise<void> {
  // Fresh: raw `pre.mermaid`. Existing: rendered wrappers carrying source in `data-mermaid-src`.
  const fresh = [...root.querySelectorAll<HTMLElement>('pre.mermaid')].map((el) => ({
    el,
    src: el.textContent ?? '',
    rendered: false,
  }));
  const existing = [...root.querySelectorAll<HTMLElement>('[data-mermaid-src]')].map((el) => ({
    el,
    src: el.getAttribute('data-mermaid-src') ?? '',
    rendered: true,
  }));
  const targets = [...fresh, ...existing];
  if (targets.length === 0) return;

  const mermaid = (await import('mermaid')).default;
  if (isCancelled()) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: dark ? 'dark' : 'default',
    themeVariables: dark ? MERMAID_VARS_DARK : MERMAID_VARS_LIGHT,
  });

  for (const t of targets) {
    try {
      const { svg } = await mermaid.render(`wiki-mmd-${Date.now()}-${mermaidSeq++}`, t.src);
      if (isCancelled()) return;
      if (t.rendered) {
        t.el.innerHTML = svg;
      } else {
        const div = document.createElement('div');
        div.className = 'not-prose my-4 flex justify-center overflow-x-auto [&>svg]:max-w-full';
        div.setAttribute('data-mermaid-src', t.src);
        div.innerHTML = svg;
        t.el.replaceWith(div);
      }
    } catch {
      /* invalid diagram — leave the source block as-is */
    }
  }
}
