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
  (`articles.ts`), in-repo `init` with `diffwiki.yaml` and conflict detection (`repo.ts`), a
  placeholder `query.ts`, and `doctor.ts` diagnostics. It throws typed `DiffwikiError`
  subclasses.
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
| `/` | `src/routes/index.tsx` | Logo, non-functional search bar, collection pills |
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
→ `@shikijs/rehype` (dual `github-light`/`github-dark` highlighting, `defaultColor:false`)
→ `rehype-stringify`. `readPage` returns that `html` string; the client `<ArticleBody>`
mounts it directly via `dangerouslySetInnerHTML` — **no `run()`/`eval`**, so article prose
and code render under a strict CSP. (The content is the user's own trusted local files.)

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
│ (256 px, lg+)  │                                  │ (1152 px+)       │
│ logo + search  │ <h1> · tags · <ArticleBody>      │ scroll-spy h2/h3 │
│ CollapsibleNav │  — or a DirListing               │ (right gutter)   │
└────────────────┴──────────────────────────────────┴──────────────────┘
```

The full-width `TopNav` spans the top; the fixed sidebar rail is offset below it
in CSS (`[data-slot='sidebar-container']`), and its in-flow gap is pinned so the
content lane doesn't shift when the sidebar is toggled. A shared `PageLayout`
gives home and article routes the same content lane + a fixed right gutter that
holds the TOC (equal to the sidebar width). Layout tokens: `--nav-h 3.5rem`,
`--sidebar-w 16rem`, `--toc-w 16rem`. Sidebar at `lg` (1024 px); TOC at 1152 px.
Dark mode = `.dark` class on `<html>`, persisted to `localStorage` (`diffwiki:color-mode`).

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

## Future Work

- Real QMD-based search replaces the dummy `query`.
- CI publish-gating and per-package release artifacts (see the plan's Future Work).
