# Architecture

> diffwiki is a git-based personal knowledge base. This document describes the monorepo and the
> CLI scaffolded on Commander.

## Overview

diffwiki stores markdown/mdx notes in named **collections**. Global collections live under
`~/.diffwiki/collections/`; any repository can also host a wiki via `diffwiki init`. A single
`~/.diffwiki/registry.json` tracks every collection (global and repo) so tools can discover
them. `DIFFWIKI_HOME` overrides the global root (used for test isolation).

## Design

The repository is a pnpm workspace with two packages:

- **`diffwiki-core`** — plain, Promise-based TypeScript. Owns all state and filesystem logic:
  path resolution (`paths.ts`), the JSON config store (`config.ts`), the collection registry
  (`registry.ts`), collection creation (`collections.ts`), article CRUD and tag operations
  (`articles.ts`), in-repo `init` with `diffwiki.yaml` and conflict detection (`repo.ts`),
  search (`query.ts` — a zero-dependency BM25 native engine plus routing to subprocess search
  plugins), and `doctor.ts` diagnostics. It throws typed `DiffwikiError` subclasses.
- **`diffwiki`** — the CLI, built with `commander`. Each subcommand's async action calls a
  core function directly and is wrapped by a `withErrors` helper that maps `DiffwikiError` to
  a clean stderr message and a non-zero exit code. `cli.ts` exports a `createProgram()`
  factory; `bin.ts` calls `createProgram().parseAsync(process.argv)`.

Both packages are plain TypeScript with no framework coupling; the core/CLI split keeps all
state logic synchronously testable.

## Implementation

- **Build**: both packages build with `tsup` (`moduleResolution: "Bundler"`, extensionless
  imports). The CLI's `tsconfig`/`vitest` map `diffwiki-core` to core's source, so typecheck
  and tests never depend on core being built first.
- **Testing**: core has vitest unit tests against a temp `DIFFWIKI_HOME`; the CLI has
  programmatic e2e tests (`createProgram().parseAsync`) plus a build-and-spawn smoke test.
- **Release**: the root package is private; both packages are publishable and share one
  version. semantic-release computes the version at the root and `@semantic-release/exec`
  stamps and builds both packages before publish.

## Search & Plugins

> **See also:** [docs/plugins.md](plugins.md) — plugin protocol, lifecycle, dependency resolution, and authoring guide. [docs/search.md](search.md) — engine routing, native BM25, qmd keyword/semantic/hybrid, ripgrep, and the web search route.

Search has two layers, both reached through `query(term, opts)` in `query.ts`:

- **Native BM25 engine** — a zero-dependency, cross-platform full-text search built into
  `diffwiki-core`. It walks every registered collection's absolute path, parses frontmatter,
  and ranks with BM25 over four weighted fields (title ×3, tags ×2, collection ×1.5, body ×1).
  An empty term returns all articles unranked (browse-all). This is the default engine and the
  fallback whenever a plugin is unavailable or errors.
- **Subprocess search plugins** — external engines (e.g. `diffwiki-qmd` for semantic/hybrid
  search, `diffwiki-ripgrep` for fast keyword search) registered in `~/.diffwiki/plugins.json`.

### Plugin protocol

Plugins are standalone executables that speak a newline-delimited JSON protocol over
stdin/stdout. `plugins/client.ts` spawns the process and issues requests
(`{ id, op, params }`) that the plugin answers with `{ id, ok, result }` or an error; log lines
are ignored. The handshake is `initialize` (protocol version + `home`), which returns the
plugin `name`, `kind` (must be `search`), `version`, and `capabilities` (advertised
`searchTypes`, `collectionFilter`, `hooks`, `setup`). Other ops are `setup`, `index`,
`search`, `notify` (lifecycle hooks), `health`, and `shutdown`. A failed handshake or spawn
kills the child and contributes no search modes.

### Engine resolution & flow

`query()` picks the engine as: explicit `opts.engine` → `config.defaultSearch`
(`"<plugin>[:<type>]"`) when it names an enabled plugin → the first enabled search plugin →
native. `resolveDefaultSearchMode()` computes the same default engine+type for UIs to
pre-select. `diffwiki index` (re)builds a plugin's index via its `index` op; article
mutations fire best-effort `notify` hooks (`plugins/events.ts`) so plugins can incrementally
reindex. `listSearchModes()` enumerates native + each enabled plugin's advertised types for
the CLI and web dropdown. `doctor` calls each plugin's `health` op to report readiness
(tool installed, index built, models present, first-search cost).

## apps/wiki — Local UI

`apps/wiki` (`diffwiki-app`) is a **TanStack Start** SSR application that provides
a browser UI for diffwiki collections running locally.

### Why SSR

The UI reads `~/.diffwiki` at request time using Node.js `fs` APIs. A pure SPA has no server
context, so TanStack Start (Vite + `@tanstack/react-start`) is used; route loaders call
`createServerFn` handlers that run on Node.

### Routes

| Route | File | Description |
|---|---|---|
| `/` | `src/routes/index.tsx` | Logo, search bar (submits to `/search`), collection pills |
| `/search` | `src/routes/search.tsx` | Query results via `runSearch`; collection filter + a search-mode dropdown (`getSearchModes`) whose selection reflects the engine actually run (`resolveDefaultSearchMode`) |
| `/$coll/$` | `src/routes/$coll.$.tsx` | Renders an article, an authored index page, or a generated directory listing; params `coll` + `_splat` |

### Server Functions (`src/server/`)

- **`getCollections`** — calls `diffwiki-core`'s `listCollections()`, returns `CollectionInfo[]`.
- **`getNavTree`** — recursively walks each collection directory and builds `CollectionTree[]`
  via `diffwiki-core` (`listArticleTree`); the app maps to route nodes via `toTreeNodes`.
- **`readPage`** — resolves `coll` + `_splat` to a `PageData` union: a **doc** (an article, or a
  folder/collection `index.md`/`README.md`, resolved by `diffwiki-core`'s `readArticle`) or a
  **listing** (auto-generated from the child nodes when the folder/collection has no index).
  Returns `null` for a genuine miss (the route loader throws `notFound()`); real errors
  propagate so they surface instead of being masked as 404s.

### Render Pipeline (eval-free)

Article markdown is rendered to HTML **server-side** by `diffwiki-core`'s
`renderArticle` — a `unified` pipeline: `remark-parse` → `remark-gfm` → `remark-rehype`
→ `rehype-slug` (heading anchor ids) → a custom `rehypeCollectToc` (extracts h2/h3 for
the TOC) → `rehypeStripLeadingH1` (drops the body's leading h1; the route renders the
frontmatter title) → `rehypeMarkMermaid` (turns ```mermaid fences into `<pre class="mermaid">`)
→ `rehypeRewriteLinks` (rewrites relative inter-page markdown links to in-app route paths
`/{coll}/{slug}`, resolved against the article's folder — a folder-index source page resolves
against its own folder — with `.md`/`.mdx` stripped and a trailing `index`/`readme` dropped;
`#hash`/`?query` preserved, collection-escaping/absolute/anchor links untouched)
→ `@shikijs/rehype` (dual `github-light`/`github-dark` highlighting, `defaultColor:false`)
→ `rehype-stringify`. `readPage` returns that `html` string; the client `<ArticleBody>`
mounts it directly via `dangerouslySetInnerHTML` — **no `run()`/`eval`**, so article prose
and code render under a strict CSP. (The content is the user's own trusted local files.)
The client `<ArticleBody>` also intercepts clicks on the rewritten internal links and routes
them through the router (client-side navigation, basepath-aware); self-referential
`#fragment` links scroll in-page instead of navigating.

### Code Blocks and Mermaid

Code is highlighted server-side (above), so it needs no client JS to display. `<ArticleBody>`
progressively enhances the mounted HTML with DOM APIs (no eval): it wraps each `pre.shiki` in
`.code-wrap` and adds a copy button, and it renders each `pre.mermaid` by dynamically importing
`mermaid` (kept out of the initial bundle) and swapping in the SVG — re-rendering on `.dark`
toggle via a `MutationObserver`. A `.dark` class on `<html>` flips the Shiki dual-theme CSS
variables without re-highlighting. Note: mermaid itself uses `eval` internally, so diagrams
are the one piece a strict CSP can block; code and prose are unaffected.

### Three-Column Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopNav (full width) — sidebar toggle · breadcrumbs … themes · GitHub  │
├────────────────┬──────────────────────────────────┬──────────────────┤
│ AppSidebar     │ Content (fills, via PageLayout)  │ TOC (256 px)     │
│ (256 px rail)  │                                  │ (desktop only)   │
│ logo + search  │ <h1> · tags · <ArticleBody>      │ scroll-spy h2/h3 │
│ CollapsibleNav │  — or a DirListing               │ (right gutter)   │
└────────────────┴──────────────────────────────────┴──────────────────┘
```

The full-width `TopNav` spans the top; below it the shell has **three responsive layouts**, applied to every route: mobile (the sidebar is an overlay sheet), tablet (the rail **pushes** content — the "layout shift"), and desktop (`>=84rem`: the rail **overlays** the left gutter and the content lane centres in the viewport with symmetric gutters). A shared `PageLayout` centres the content lane and, on desktop, places the TOC in the right gutter **without displacing the lane** — so pages with and without a TOC lay out identically. Layout tokens: `--nav-h 3.5rem`, `--sidebar-w 16rem`, `--toc-w 16rem`, `--content-max 48rem`. The full model (breakpoints, the push-vs-overlay gap regime, Tailwind mechanics) is documented in [`architecture/app-shell.md`](architecture/app-shell.md). Dark mode = `.dark` class on `<html>`, persisted to `localStorage` (`diffwiki:color-mode`).

### Testing

- **vitest unit** — `apps/wiki/tests/unit/**/*.test.ts` (vitest.config.ts scoped to this
  glob so it never picks up Playwright specs). Covers app pure helpers such as `toTreeNodes`
  (the tree builder is tested in diffwiki-core).
- **Playwright e2e** — `apps/wiki/tests/e2e/**/*.spec.ts`. A `globalSetup` seeds a temp
  `DIFFWIKI_HOME` (`/tmp/diffwiki-e2e-home`) with fixture collections. Two `webServer`s boot
  with `DIFFWIKI_HOME` injected via `env`: the vite dev server (`pnpm dev`, :3000) and the
  **built production bin** (`node bin/wiki-server.mjs`, :4321). Specs assert the home + content
  routes (title, tags, prose, code copy button, mermaid SVG), and `prod-server.spec.ts` checks
  the built bin serves static assets + doesn't 500 — bin-only regressions the dev server hides.
- **`mise run test:e2e`** — runs workspace vitest e2e suites then the app Playwright suite.

## Static export (SSG)

The wiki app is a TanStack Start (SSR) application whose data loads through server functions. For static hosting (GitHub Pages or any file host) these are swapped at build time by a single `data-source` seam (`apps/wiki/src/lib/data-source.ts`) keyed on `VITE_DIFFWIKI_STATIC` — live builds call the server functions; static builds fetch pre-generated JSON under `${BASE_URL}_data/`. Site-data builders live in `diffwiki-core` (`site.ts`: `buildNavTree`, `buildCollections`, `resolvePage`, `toTreeNodes`), shared by the live server functions, the client data-source, and the exporter. `diffwiki export` drives `apps/wiki/bin/export.mjs` (Node + core + the shipped `dist-static` bundle): it emits `_data/*.json` + `search-index.json`, copies client assets, and prerenders every route by calling the built server bundle's `fetch` handler with an on-disk `_data` fetch shim. Git branch info is omitted under `DIFFWIKI_STATIC` (a `console.warn` per affected collection); `/api/watch` SSE + `LiveReload` are compiled out of static builds. External collections (`diffwiki add`) are registered by a stable git repo id (root-commit hash, else origin URL) with `type: 'external'`, pointing at the repo's `docs/` directory; linked worktrees are refused.

See also:
- [Static site generation](architecture/static-site-generation.md) — data-source seam, export harness, base-path handling, `dist-static` build.
- [Search](architecture/search.md) — `buildSearchIndex`, `search-index.json`, `SearchBox` component.
- [Collections](architecture/collections.md) — collection model, `external` type, git repo identity, `diffwiki add` vs `diffwiki init`.

## Future Work

- CI publish-gating and per-package release artifacts (see the plan's Future Work).
