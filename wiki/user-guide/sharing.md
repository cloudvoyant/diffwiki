---
title: Sharing & Publishing
tags:
  - user-guide
  - publishing
  - sharing
order: 6
---

# Sharing & Publishing

diffwiki turns a repository into a self-describing wiki project with a single committed file: a repo-root `diffwiki.yaml`. That project config declares which [collections](/user-guide/collections) to publish and customizes the home page, and it is the reproducible source of truth behind both local preview and the static build — including this very site.

## The `diffwiki.yaml` project config

The project config has two top-level blocks: a `collections:` list and a `site:` block. It is backward compatible with the single-collection form that `diffwiki init` writes, but for a multi-section site you use the extended form:

```yaml
# diffwiki project config — drives the published site.
site:
  home:
    tagline: your local knowledge base
    cards:
      - icon: rocket
        title: Getting Started
        subtitle: Install, create your first wiki, and publish it.
        link: /getting-started
      - icon: book-open
        title: User Guide
        subtitle: Collections, search, and agent memory / RAG.
        link: /user-guide
collections:
  - name: getting-started
    path: wiki/getting-started
    order: 1
  - name: user-guide
    path: wiki/user-guide
    order: 2
```

### The `collections:` list

Each entry has a `name` (the URL slug), a `path` (the content directory relative to the project root), and an optional `order` that positions the section in the top-level navigation. The display title shown in navigation comes from each collection's `index.md` frontmatter `title:`, not from the config — so `name: user-guide` produces the `/user-guide` URL while the nav label reads "User Guide". This is the same title-versus-slug rule described in [Collections](/user-guide/collections).

### The `site:` block

The diffwiki wordmark and logo are fixed — it is a wiki, not a bespoke site — so branding is not configurable. What you customize is the home page:

- `site.home.tagline` — the line shown under the wordmark on the home page. Optional; omitted, the home page shows an animated default.
- `site.home.cards[]` — the cards rendered below the search bar. Each card is `{ icon, title, subtitle, link }`, where `title` and `link` are required and `icon` and `subtitle` are optional. `link` is an in-site path such as `/getting-started`. An unknown or missing `icon` simply renders no icon.

## Preview locally

`diffwiki preview` renders the site from `diffwiki.yaml` — the project's declared collections and home config — not from your machine-local global `~/.diffwiki` registry. That makes the preview match exactly what will publish, regardless of what other collections you have registered:

```bash
diffwiki preview
```

## Build and publish a static site

The static build produces a fully self-contained site — HTML, assets, and the client-side BM25 [search](/user-guide/search-and-rag) index — deployable to GitHub Pages or any file host. Build it straight from the committed `diffwiki.yaml` with `--project`:

```bash
npx diffwiki export --project -o dist-site -b /my-repo/
```

`--project` seeds an ephemeral registry from the `diffwiki.yaml` collections (so the build is reproducible in CI and never depends on a machine-local registry) and runs a filtered static export. The showcase site you are reading is built with exactly this command, wired into a CI workflow that publishes to GitHub Pages on every push.

- `--project [dir]` builds only the repo project from its `diffwiki.yaml` (defaults to the current directory).
- `-o, --out` output directory.
- `-b, --base` base URL path (`/my-repo/` for a GitHub Pages project site).
- `-f, --filter` / `-e, --exclude` glob over collection names to include or exclude.

Point GitHub Pages at the resulting directory and the wiki is live, with client-side `/search` working over the shipped index and no server required.

## Sharing the repo itself

Publishing a static site is one way to share; the other is sharing the repository. Because a repo collection's wiki [travels with the code](/user-guide/collections), anyone who clones the repo gets the wiki too — they run `diffwiki list` and it appears alongside their own collections, ready to browse and search locally. The `diffwiki.yaml` you committed means they can also `diffwiki preview` or build the same site you do. The wiki is part of the project, not a separate artifact to distribute.

## Where to go next

- [Collections](/user-guide/collections) — the collection types a project config publishes.
- [Search & RAG](/user-guide/search-and-rag) — how the client-side search index ships with the site.
- The [CLI Reference](/api-docs/cli) and [diffwiki-core](/api-docs/core) document `export`, `preview`, and the project-config API.
