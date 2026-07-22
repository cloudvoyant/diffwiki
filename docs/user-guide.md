# diffwiki CLI — User Guide

> A git-based personal knowledge base: manage topic-specific wikis ("collections") from your
> terminal, globally or attached to any repo.

## Introduction

diffwiki lets you capture and organize markdown notes into named collections. Global
collections live under `~/.diffwiki/collections`; you can also `init` a wiki inside any
repository so its notes travel with the code. A single `registry.json` tracks every
collection so `diffwiki list` can find them all. This guide covers the CLI shipped by this
scaffold, including real full-text search (`query`) — a built-in BM25 engine plus optional
subprocess search plugins for keyword (ripgrep) and semantic/hybrid (QMD) search — and a
local web UI.

## Requirements

- Node.js (LTS) and pnpm 10 (managed by `mise`).
- Build once with `mise run build` before invoking the real binary, or run commands through
  the workspace during development.

## Quick Start

```bash
# 1. Pick a default collection so you can omit the name later
diffwiki create notes
diffwiki config-set defaultCollection notes

# 2. Add an article (returns the file path it wrote)
diffwiki add -p "notes:Setting up mise" -t tooling,setup "# Setting up mise

Install mise, then run \`mise install\`."
# → ~/.diffwiki/collections/notes/setting-up-mise.md

# 3. See what you have
diffwiki list
diffwiki query mise
```

## Primary Use Case — capturing a note

`diffwiki add` is the fast path. `-p` takes `[collection:]title`; if you omit `collection:`
it uses `config.defaultCollection`. `-t` may be repeated and accepts comma-separated tags.
The trailing argument is the optional markdown body.

```bash
diffwiki add -p "Rebasing safely" -t git,notes "# Rebasing safely

Always \`git pull --rebase\` before pushing to avoid clobbering remote commits."
```

## In-repo wikis

```bash
cd my-project
diffwiki init                 # writes diffwiki.yaml, registers the repo wiki globally
diffwiki init -c my-wiki -p docs/wiki   # explicit collection name + path within the repo
diffwiki list                 # the repo wiki now appears alongside global ones
```

`init` defaults the collection name to the repo name and the path to `wiki/`. If the derived
name already belongs to a different collection, it is disambiguated (`name-2`, `name-3`, …).

## Command Reference

### `diffwiki list`

Lists every registered collection (global and repo) with its type and path.

### `diffwiki create <name>`

Creates a global collection directory and registers it. **Errors** if the name is taken.

### `diffwiki add -p "[coll:]title" [-t tags]… [body]`

Creates an article. `-p` → `[collection:]title` (collection optional → default). `-t` →
repeatable, comma-split tags. `body` → optional markdown (defaults to `# <title>`).
**Returns** the article path on stdout.

### `diffwiki update -p "coll:path" <body>`

Replaces an article's body, preserving its title and tags.

> **Path form:** `-p "coll:path"` resolves the `path` segment the same way `add` writes it
> — it is slugified. So you can pass either the slug (`notes:my-title`) or the original
> title (`notes:My Title`); both resolve to `my-title.md`. Pass an explicit `.md`/`.mdx`
> filename to bypass slugifying.

### `diffwiki add-tags | remove-tags | update-tags -p "coll:path" <comma,separated,tags>`

Adds, removes, or replaces (`update-tags`) an article's tags.

### `diffwiki remove -p "coll:path"`

Deletes an article file.

### `diffwiki query [--engine name] [-c collection] [-t type] [term]`

Full-text search across every registered collection. Prints one tab-separated result per line
(`collection` · `title` · `path`, plus a snippet when the engine returns one). An empty term
lists all articles.

- `--engine <name>` — the search engine to use. Defaults to `config.defaultSearch`, else the
  first enabled search plugin, else the built-in `native` BM25 engine.
- `-c, --collection <name>` — limit the search to one collection.
- `-t, --type <type>` — engine-defined search type (e.g. `keyword`, `semantic`, `hybrid` for
  the QMD plugin). Ignored by the native engine.

The native engine ranks with BM25 over title/tags/collection/body and needs no setup. If a
plugin is unavailable or errors, `query` transparently falls back to native.

### Search plugins — `diffwiki plugin …` and `diffwiki index`

Search can be extended with subprocess plugins (e.g. `diffwiki-qmd` for semantic/hybrid,
`diffwiki-ripgrep` for fast keyword search).

```bash
# Install a plugin from an npm spec (or a local path) and provision it
diffwiki plugin install diffwiki-ripgrep
diffwiki plugin install diffwiki-qmd --prefetch-models   # heavy: pre-download models
diffwiki plugin install ./path/to/plugin --no-setup      # skip setup; run `diffwiki index` later

# Register an already-installed executable as a plugin
diffwiki plugin register my-engine --command node /abs/adapter.js

# List registered plugins (name, kind, version, enabled, managed, spawnable)
diffwiki plugin list

# Remove a plugin
diffwiki plugin remove diffwiki-qmd

# (Re)build the active plugin's index; --embed also builds vector embeddings
diffwiki index
diffwiki index --embed
```

Make a plugin the default engine with `diffwiki config-set defaultSearch <engine[:type]>`
(e.g. `diffwiki-qmd:semantic`). `diffwiki query` then uses it unless you pass `--engine`.

### `diffwiki init [-c collection] [-p path]`

Creates an in-repo wiki, writes `diffwiki.yaml`, and registers it globally.

### `diffwiki config-set <key> <value>` / `diffwiki config-get <key>`

Reads/writes `~/.diffwiki/config.json`. Keys include `defaultCollection` and `defaultSearch`
(a `<engine[:type]>` string selecting the default search engine and, optionally, its type).

### `diffwiki doctor`

Diagnoses configuration: home/registry presence, collection paths, and default-collection
validity. It also checks search-plugin readiness — whether `defaultSearch` names an installed
engine, and each enabled plugin's `health` (tool installed, index built, models present,
first-search cost). Exits non-zero if any error-level issue is found.

## Configuration

- **`DIFFWIKI_HOME`** — overrides `~/.diffwiki` (used by tests to sandbox state).
- **`~/.diffwiki/registry.json`** — `{ version, collections: [{ name, type, path, createdAt
}] }`.
- **`~/.diffwiki/config.json`** — `{ defaultCollection?: string, defaultSearch?: string }`.
- **`~/.diffwiki/plugins.json`** — the registry of installed/registered search plugins.
- **`diffwiki.yaml`** (in-repo) — `{ collection, path }`.

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
- **Breadcrumbs** — the current collection → folder → page trail; the collection crumb links back to its index.

### Left Navigation

The sidebar holds the logo and search in its header and the collection nav below; it starts below the full-width top bar. Every collection is a single collapsible menu item, collapsed by default. Click the chevron to expand a collection/folder and reveal its children; click the label to navigate to that collection's or folder's index page. Nested directories (unlimited depth) nest as collapsible items. On mobile the sidebar overlays as a sheet.

### Table of Contents

On content pages a TOC panel appears on the right (on screens wider than 1152 px). It lists
`h2` and `h3` headings extracted from the rendered article and highlights the currently
visible heading as you scroll.

### Running the UI from the Published Package

The `diffwiki` CLI can run the published `diffwiki-app` package locally so you can view
your wiki in the browser without setting up the development environment. The commands fetch
the latest published version automatically via `npx -y diffwiki-app@latest`.

```bash
# Start the UI on the default port (4321)
diffwiki up

# Start on a custom port
diffwiki up --port 8080

# Open the UI in the browser (starts it first if not already running)
diffwiki open

# Check whether the UI is running
diffwiki status
# → running · http://127.0.0.1:4321 · pid 12345 · since 2026-07-21T10:00:00.000Z
# (or "stopped" if not running)

# Stop the running UI
diffwiki down
```

The running state (PID, port, URL, start time) is stored in `~/.diffwiki/ui.json`.

> **Note:** `diffwiki up` and `diffwiki open` require the `diffwiki-app` package to be
> published on npm. During local development, use `mise run dev` instead.

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
registered via `diffwiki init`) via a server-side `chokidar` singleton that streams change
events to the browser over SSE at `/api/watch`. The client calls `router.invalidate()` on
each event to re-run the active route's loaders and re-render with fresh content.

As a dependency-free baseline, the browser also revalidates loaders whenever the tab
regains focus (switching back to it after editing in your editor), which works even without
the SSE connection.

> **Note:** Live reload is a dev-server feature. The production build (`mise run build` +
> `pnpm preview`) does not watch the filesystem. Use `mise run dev` during active writing.

## Future Work / Troubleshooting

### Known Limitations

- Semantic/hybrid search requires installing the `diffwiki-qmd` plugin, which depends on the
  external `qmd` tool and downloads models (~2 GB) on first semantic/hybrid use. Without a
  plugin, search uses the built-in native BM25 engine (keyword only).
- Content is rendered as **Markdown** (GFM), highlighted server-side with Shiki. A `.mdx` extension is accepted but treated as plain Markdown — embedded JSX/components are not executed.
- Publishing/CI wiring for the new packages is a follow-up (see plan Future Work).

### Common Issues

#### "No default collection set"

Run `diffwiki config-set defaultCollection <name>` (the collection must exist), or pass
`collection:` explicitly in `-p`.

#### State ended up somewhere unexpected

Check `DIFFWIKI_HOME` — if set, diffwiki uses it instead of `~/.diffwiki`. Run `diffwiki
doctor` to see resolved paths.

## References

- [Commander.js](https://www.npmjs.com/package/commander)
