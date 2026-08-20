# diffwiki CLI — User Guide

> A git-based personal knowledge base: manage topic-specific wikis ("collections") from your
> terminal, globally or attached to any repo.

## Introduction

diffwiki lets you capture and organize markdown notes into named collections. Global
collections live under `~/.diffwiki/collections`; you can also `init` a wiki inside any
repository so its notes travel with the code. A single `registry.json` tracks every
collection so `diffwiki collection list` can find them all. This guide covers the CLI shipped by this
scaffold, including real full-text search (`search query`) — a built-in BM25 engine plus optional
subprocess search plugins for keyword (ripgrep) and semantic/hybrid (QMD) search — and a
local web UI.

## Requirements

- Node.js (LTS) and pnpm 10 (managed by `mise`).
- Build once with `mise run build` before invoking the real binary, or run commands through
  the workspace during development.

## Quick Start

```bash
# 1. Pick a default collection so you can omit the name later
diffwiki collection create notes
diffwiki config set defaultCollection notes

# 2. Add an article (returns the file path it wrote)
diffwiki article create "notes:Setting up mise" -t tooling,setup -b "# Setting up mise

Install mise, then run \`mise install\`."
# → ~/.diffwiki/collections/notes/setting-up-mise.md

# 3. See what you have
diffwiki collection list
diffwiki search query mise
```

## Primary Use Case — capturing a note

`diffwiki article create` is the fast path. The positional `<collection:title>` takes `[collection:]title`; if you omit `collection:`
it uses `config.defaultCollection`. `-t` may be repeated and accepts comma-separated tags, and `-b/--body` sets the markdown body
(a `# <title>` heading is written when omitted). `--audience`/`--status` set visibility and publish state.

```bash
diffwiki article create "Rebasing safely" -t git,notes -b "# Rebasing safely

Always \`git pull --rebase\` before pushing to avoid clobbering remote commits."
```

## In-repo wikis

```bash
cd my-project
diffwiki collection init                 # writes diffwiki.yaml, registers the repo wiki globally
diffwiki collection init -c my-wiki -p docs/wiki   # explicit collection name + path within the repo
diffwiki collection list                 # the repo wiki now appears alongside global ones
```

`init` defaults the collection name to the repo name and the path to `wiki/`. If the derived
name already belongs to a different collection, it is disambiguated (`name-2`, `name-3`, …).

## Command Reference

> Commands are grouped by entity: `collection`, `article`, `tags`, `search`, `config`, `site`, `ui`, plus `plugin` and top-level `doctor`.

### `diffwiki collection list`

Lists every registered collection (global and repo) with its type and path.

### `diffwiki collection create <name> [--hidden]`

Creates a global collection directory and registers it. **Errors** if the name is taken. `--hidden` marks it a **system** collection (audience `system`) — hidden by default from search, recall, lint, and the UI (reveal with `showSystem`).

### `diffwiki article create "<[coll:]title>" [-b body] [-t tags]… [--audience …] [--status …]`

Creates an article. The positional `<collection:title>` → `[collection:]title` (collection optional → default). `-b/--body` → optional markdown (defaults to `# <title>`). `-t` → repeatable, comma-split tags. `--audience <public|private|system>` (default `public`) and `--status <draft|published|deprecated>` (default `published`) set the frontmatter axes. The title may be a nested path (`coll:guide/setup`) — every segment is slugified into subdirectories. **Returns** the article path on stdout.

### `diffwiki article update "<coll:slug>" [-b body] [-t tags]… [--audience …] [--status …]`

Updates an article's body, tags, audience, and/or status — each optional, pass at least one. `-b/--body` replaces the body; `-t/--tag` **replaces** the whole tag set; `--audience`/`--status` set those axes (setting them back to `public`/`published` clears the frontmatter). Title is always preserved.

> **Path form:** `"coll:slug"` resolves the `slug` segment the same way `article create` writes it — every path segment is slugified. So you can pass either the slug (`notes:my-title`) or the original title (`notes:My Title`), and nested paths (`notes:guide/setup` or `notes:Guide/Setup`) resolve to `guide/setup.md`. Pass an explicit `.md`/`.mdx` filename to bypass slugifying.

### `diffwiki tags add | remove | set "<coll:slug>" <comma,separated,tags>`

Adds, removes, or replaces (`tags set`) an article's tags.

### `diffwiki article remove "<coll:slug>"`

Deletes an article file.

### `diffwiki search query [--engine name] [-c collection[,…]] [-t type] [term]`

Full-text search across every registered collection (short alias: `diffwiki search q`). Prints one tab-separated result per line (`collection` · `title` · `path`, plus a snippet when the engine returns one). An empty term lists all articles. `system`-audience collections and articles are excluded by default — reveal them by naming a collection explicitly with `-c`, or by setting `showSystem`.

- `--engine <name>` — the search engine to use. Defaults to `config.defaultSearch`, else the first enabled search plugin, else the built-in `native` BM25 engine.
- `-c, --collection <names>` — limit the search to a collection, or a comma-separated set (`-c notes,knowledge-base`).
- `-t, --type <type>` — engine-defined search type (e.g. `keyword`, `semantic`, `hybrid` for the QMD plugin). Ignored by the native engine.

The native engine ranks with BM25 over title/tags/collection/body and needs no setup. If a plugin is unavailable or errors, `search query` transparently falls back to native.

### Search plugins — `diffwiki plugin …` and `diffwiki search index`

Search can be extended with subprocess plugins (e.g. `diffwiki-qmd` for semantic/hybrid, `diffwiki-ripgrep` for fast keyword search).

```bash
# Install a plugin from an npm spec (or a local path) and provision it.
# Multiple search plugins can be installed side by side; each install makes
# itself the default engine (opt out with --no-default).
diffwiki plugin install diffwiki-ripgrep
diffwiki plugin install diffwiki-qmd --prefetch-models   # heavy: pre-download models
diffwiki plugin install ./path/to/plugin --no-setup      # skip setup; run `diffwiki search index` later
diffwiki plugin install diffwiki-qmd --no-default        # install without changing the default

# Register an already-installed executable as a plugin
diffwiki plugin register my-engine --command node /abs/adapter.js

# List registered plugins (name, kind, version, enabled, managed, spawnable)
diffwiki plugin list

# Remove a plugin
diffwiki plugin remove diffwiki-qmd

# (Re)build the active plugin's index; --embed also builds vector embeddings
diffwiki search index
diffwiki search index --embed
```

Installing a plugin makes it the default engine automatically; change it any time with `diffwiki config set defaultSearch <engine[:type]>` (e.g. `diffwiki-qmd:semantic`). `diffwiki search query` then uses the default unless you pass `--engine`.

### `diffwiki collection init [-c collection] [-p path]`

Creates an in-repo wiki, writes `diffwiki.yaml`, and registers it globally.

### `diffwiki config set <key> <value>` / `diffwiki config get <key>`

Reads/writes `~/.diffwiki/config.json`. Keys include `defaultCollection`, `defaultSearch` (a `<engine[:type]>` string selecting the default search engine and, optionally, its type), `editor`, and `showSystem` (boolean — set `true` to reveal `system`-audience content in search and the wiki UI).

### `diffwiki collection edit [name] [--editor cmd]` / `diffwiki article edit "<coll:slug>" [--editor cmd]`

Opens a collection directory (`collection edit`, default: the current repo collection) or a single article (`article edit`) in your editor. The editor is resolved from `--editor`, then config `editor`, then `$VISUAL`/`$EDITOR`.

### `diffwiki lint [-c current|all|<names>]`

Lints articles against the template shapes — checks frontmatter, token budgets, reference presence, lingering `draft` status, and `diffwiki-template` tag leaks. `-c` selects scope: `current` (the cwd's collection, default), `all`, or a comma-separated list. Skips `system` collections. Exits non-zero if any error-level finding exists. (The `dw-lint` agent skill wraps this.)

### `diffwiki context show | set <names> | add <names> | remove <names>`

Manages the recall/search context — `context.collections` in the repo's `diffwiki.yaml` (the collections `dw-recall` filters to by default). Edits the YAML in place, preserving your other keys and comments (creating the file if absent). Use this instead of hand-editing `diffwiki.yaml`; `<names>` is comma-separated.

### `diffwiki templates init | list [--json]`

Manages the authoring templates in `~/.diffwiki/templates` (used by the `dw-*` skills). `init` seeds them from the CLI's bundled copies (never overwriting your own). `list` prints each template's shape, purpose, and token budget — read from that template's frontmatter, so the set is self-describing and customizable (add a `*-template.md` with `shape:`/`purpose:`/`budget:` frontmatter and it shows up).

### `diffwiki doctor [--fix]`

Diagnoses configuration: home/registry presence, collection paths, and default-collection validity. It also checks search-plugin readiness — whether `defaultSearch` names an installed engine, and each enabled plugin's `health` (tool installed, index built, models present, first-search cost). Exits non-zero if any error-level issue is found. `--fix` re-provisions enabled plugins, auto-installing missing tools (e.g. `rg`/`fzf`).

## Configuration

- **`DIFFWIKI_HOME`** — overrides `~/.diffwiki` (used by tests to sandbox state).
- **`~/.diffwiki/registry.json`** — `{ version, collections: [{ name, type, path, createdAt
}] }`.
- **`~/.diffwiki/config.json`** — `{ defaultCollection?: string, defaultSearch?: string, editor?: string, showSystem?: boolean }`.
- **`~/.diffwiki/plugins.json`** — the registry of installed/registered search plugins.
- **`diffwiki.yaml`** (in-repo) — legacy `{ collection, path }`, or the extended `{ site?, collections: [...], context?: { collections: [...] } }` where `context.collections` lists the collections recall/search filters to by default.

## Local Web UI (`apps/wiki`)

The `apps/wiki` package ships a browser UI for browsing your diffwiki collections. It is a
TanStack Start (SSR) app that reads `~/.diffwiki` at request time — no separate sync step
needed.

### Starting the UI

```bash
# Install dependencies (first time or after pulling)
mise run install

# Start the development server (defaults to http://localhost:3000)
mise run dev
```

`mise run dev` runs `pnpm --filter "diffwiki-app" dev` and starts a local Vite dev server.
Open `http://localhost:3000` in your browser.

### Routes

| URL | What you see |
|---|---|
| `/` | The diffwiki logo, a search bar (Enter submits to `/search`), and a pill for each registered collection |
| `/search?q=…` | Search results for `q`, with a collection filter and a search-mode dropdown (native BM25 plus any installed plugin modes). The dropdown pre-selects the engine actually used for the query |
| `/<collection>` | The collection's index page — an authored `index.md`/`README.md` at the collection root if present, otherwise an auto-generated listing of its top-level folders and articles |
| `/<collection>/<folder>` | A folder's index page — the folder's authored `index.md`/`README.md`, otherwise an auto-generated listing of its children |
| `/<collection>/<path>` | The rendered article; e.g. `/notes/guide/setup` renders `~/.diffwiki/collections/notes/guide/setup.md` |

Any collection or folder is navigable: it resolves to an authored index file (`index.md`, `index.mdx`, or `README.md`, matched case-insensitively) when one exists, and falls back to a generated directory listing otherwise.

### Theme and Dark Mode

The top bar holds a stateful sidebar toggle and breadcrumbs on the left, and the theme and GitHub controls on the right:
- **Light/Dark toggle** — switches `.dark` on `<html>`, persisted to `localStorage`.
- **Theme picker** — choose from 52 built-in diffbook themes. The
  selection is persisted to `localStorage` as `diffwiki:theme`.
- **Breadcrumbs** — the current collection → folder → page trail; every intermediate crumb (the collection and each folder) is a link to that level's index, while the current page is plain text.

### Left Navigation

The sidebar holds the logo and search in its header and the collection nav below; it starts below the full-width top bar. Every collection is a single collapsible menu item, collapsed by default. Click the chevron to expand a collection/folder and reveal its children; click the label to navigate to that collection's or folder's index page. Nested directories (unlimited depth) nest as collapsible items. On mobile the sidebar overlays as a sheet.

### Table of Contents

On content pages a TOC panel appears on the right (on screens wider than 1152 px). It lists
`h2` and `h3` headings extracted from the rendered article and highlights the currently
visible heading as you scroll.

### Running the UI from the Published Package

The `diffwiki` CLI can run the published `diffwiki-app` package locally so you can view
your wiki in the browser without setting up the development environment. The commands run
the `diffwiki-app` release that shipped with your CLI version — pinned, never a floating
`@latest` — fetched on demand via `npx -y diffwiki-app@<version>`.

```bash
# Start the UI on the default port (4321)
diffwiki ui up

# Start on a custom port
diffwiki ui up --port 8080

# Open the UI in the browser (starts it first if not already running)
diffwiki ui open

# Check whether the UI is running
diffwiki ui status
# → running · http://127.0.0.1:4321 · pid 12345 · since 2026-07-21T10:00:00.000Z
# (or "stopped" if not running)

# Stop the running UI
diffwiki ui down
```

The running state (PID, port, URL, start time) is stored in `~/.diffwiki/ui.json`.

> **Note:** `diffwiki ui up` and `diffwiki ui open` require the `diffwiki-app` release
> matching your CLI version to be published on npm. During local development, use
> `mise run dev` instead.

### Building for Production Preview

```bash
mise run build      # compiles the app
# then open apps/wiki and: pnpm preview
```

### Running Tests

```bash
# Unit tests (vitest, scoped to tests/unit/**)
mise run test

# Playwright e2e (boots the dev server against a sandboxed DIFFWIKI_HOME)
# Install Playwright browsers first (once per machine):
pnpm --filter diffwiki-app exec playwright install --with-deps chromium

mise run test:e2e
```

`mise run test:e2e` seeds a temporary `DIFFWIKI_HOME` at `/tmp/diffwiki-e2e-home` with a
fixture `notes` collection, starts the dev server against it, and runs the Playwright specs.
The home route and the content route (including code blocks and mermaid diagrams) are
verified.

### Live Reload

When the dev server is running (`mise run dev`), any `.md` or `.mdx` file you edit on disk
is automatically reflected in open browser tabs within about one second — no manual refresh
needed. The app watches your collection directories (including out-of-tree collections
registered via `diffwiki collection init`) via a server-side `chokidar` singleton that streams change
events to the browser over SSE at `/api/watch`. The client calls `router.invalidate()` on
each event to re-run the active route's loaders and re-render with fresh content.

As a dependency-free baseline, the browser also revalidates loaders whenever the tab
regains focus (switching back to it after editing in your editor), which works even without
the SSE connection.

> **Note:** Live reload is a dev-server feature. The production build (`mise run build` +
> `pnpm preview`) does not watch the filesystem. Use `mise run dev` during active writing.

## External collections & static export

### `diffwiki collection add [-d <dir>]`

Register the current git repo as an **external** collection without a `diffwiki.yaml`: the title is the git remote repo name (fallback repo dir), the content dir is `docs/` by default (`-d` to override), non-git dirs are auto-initialised, collections are unique by git repo id, and linked worktrees are refused (add the source repo). Use `diffwiki collection init` to override title/paths via a `diffwiki.yaml`.

### `diffwiki ui open`

Run inside an external collection, `ui open` lands on that collection's root route (`/{coll}`); elsewhere it opens the site home. The sidebar shows an external collection's checked-out branch and a `↓N` "behind remote" marker (live only).

### `diffwiki site export -o <dir> [--base /repo/] [--filter <globs>] [--exclude <globs>]`

Generate a fully static site (HTML + hashed assets + `_data/` JSON + `search-index.json` + `.nojekyll`) deployable to GitHub Pages or any file host. Pass `--base /<repo>/` for a project sub-path. Export a subset with `--filter <globs>` (only these collections) and/or `--exclude <globs>` (everything but these) — comma-separated name globs (`*`/`?`); an unmatched pattern or an empty selection aborts before anything is generated. Content is frozen at export time; git branch info is omitted (a console warning lists affected collections); search is the native BM25 engine run client-side over the generated index (semantic/plugin engines are server-only).

## Future Work / Troubleshooting

### Known Limitations

- Semantic/hybrid search requires installing the `diffwiki-qmd` plugin, which depends on the
  external `qmd` tool and downloads models (~2 GB) on first semantic/hybrid use. Without a
  plugin, search uses the built-in native BM25 engine (keyword only).
- Content is rendered as **Markdown** (GFM), highlighted server-side with Shiki. A `.mdx` extension is accepted but treated as plain Markdown — embedded JSX/components are not executed.
- Publishing/CI wiring for the new packages is a follow-up (see plan Future Work).

### Common Issues

#### "No default collection set"

Run `diffwiki config set defaultCollection <name>` (the collection must exist), or pass
`collection:` explicitly in the `<collection:title>` positional.

#### State ended up somewhere unexpected

Check `DIFFWIKI_HOME` — if set, diffwiki uses it instead of `~/.diffwiki`. Run `diffwiki
doctor` to see resolved paths.

## Publishing

A repo-root `diffwiki.yaml` declares the collections to publish and customizes the home page:

```yaml
site:
  repo: https://github.com/you/your-repo # top-nav GitHub link
  home:
    tagline: your local knowledge base
    cards:
      - icon: rocket
        title: Getting Started
        subtitle: Install, create a wiki, publish it.
        link: /getting-started
collections:
  - name: getting-started
    path: wiki/getting-started
  - name: user-guide
    path: wiki/user-guide
```

- **Collection titles** come from each collection's `index.md` frontmatter `title:`; URLs use the slug name.
- **Home cards** are `site.home.cards[]` — `icon` (from the curated set: `rocket`, `book-open`, `code`, `compass`, `search`, `git-branch`, `sparkles`, `file-text`, `boxes`, `database`, `terminal`, `map`), `title`, `subtitle`, `link`.
- The **diffwiki logo and wordmark are fixed branding** — not configurable. This is a wiki, not a custom site.
- **Footer copyright** is `site.copyright` — either a bare string or `{ text, url }`. There is no default (no notice shown when unset). It covers the **site/software**; article content copyright stays with its respective authors.

```yaml
site:
  copyright:
    text: © 2026 Acme, Inc.
    url: https://acme.example # optional — links the notice
```

Preview locally (rendered from `diffwiki.yaml`, not your global `~/.diffwiki` collections):

```bash
diffwiki site preview            # http://127.0.0.1:4321
```

Build and serve the static site:

```bash
mise run build:pages                              # → dist-site/, base /diffwiki/
node apps/wiki/bin/serve-static.mjs dist-site     # spot-check
```

Deployment is automatic: `.github/workflows/pages.yml` builds and deploys to GitHub Pages on every push to `main`.

## References

- [Commander.js](https://www.npmjs.com/package/commander)

## Agent skills

Install the skills via agentskills; if diffwiki isn't installed yet, run `/dw-install`. Then: `/dw-init` to set up a wiki, `/dw-remember <what>` to capture a draft, `/dw-recall <query>` to pull snippets into context, `/dw-lint` to check the wiki, `/dw-learn` to capture + mine your sessions, `/dw-dream` to maintain the wiki. Full reference: [Agent skills](./agent-skills.md).
