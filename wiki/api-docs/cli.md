---
title: CLI Reference
tags:
  - cli
  - reference
order: 1
---

# CLI Reference

The `diffwiki` command-line interface is the primary way to manage collections, articles, search, plugins, and the local UI. This page documents every command, every option, and its default — the complete surface.

## Running the CLI

All you need is a recent [Node.js](https://nodejs.org) LTS. Run diffwiki on demand with **`npx`**:

```
npx diffwiki <command> [args]
```

Or install it **globally** so the `diffwiki` binary is on your PATH:

```
npm install -g diffwiki
diffwiki <command> [args]
```

Every command on this page is written as bare `diffwiki <command>`, which assumes a global install; prefix it with `npx` if you would rather not install. Building from source is only for contributing to diffwiki itself.

## Global options

These apply to every invocation. Run `diffwiki` with no subcommand to print help.

```
diffwiki [-v | --verbose] [--log <level>] <command> [args]
```

- `-v, --verbose` — verbose logging (sets the log level to `debug`).
- `--log <level>` — log level: `trace|debug|info|warning|error|fatal`.
- `-V, --version` — print the CLI version.
- `-h, --help` — print help (also shown after any error).

Logging flags are read from `process.argv` at startup (before any command runs), so logs are configured before the first action.

> **Deprecated aliases:** every pre-taxonomy command (`list`, `add-article`, `config-set`, `up`, …) still works but is hidden and prints a one-line notice to stderr (`⚠ "diffwiki <old>" is deprecated; use "diffwiki <new>".`). Article/tag aliases keep their original `-p/--path` form. Use the grouped commands below.

## Collections

Collections are the top-level content units. See the [collections guide](/user-guide/collections) for concepts.

### `collection list`

List all registered collections with type, path, and (for external collections) the current git branch.

```
diffwiki collection list
```

No options. Example:

```
diffwiki collection list
```

### `collection create <name>`

Create a new global collection (stored under `~/.diffwiki/collections/<name>`).

```
diffwiki collection create <name>
```

- `<name>` (required) — collection name.

```
diffwiki collection create handbook
```

### `collection add`

Add the current git repo as an **external** collection — content served from a docs directory, with no `diffwiki.yaml` written. Registered globally and discoverable via `diffwiki collection list`.

```
diffwiki collection add [-d <dir>]
```

- `-d, --docs <dir>` — content dir relative to the repo root. Default: `docs`.

```
diffwiki collection add --docs documentation
```

### `collection init`

Initialize an in-repo wiki: create the wiki directory, write a `diffwiki.yaml`, and register the collection globally.

```
diffwiki collection init [-c <name>] [-p <path>]
```

- `-c, --collection <name>` — collection name. Default: the repo name.
- `-p, --path <path>` — wiki path within the repo. Default: `wiki`.

```
diffwiki collection init --collection docs --path wiki
```

### `collection edit [name]`

Open a collection directory in your editor, so you can write markdown without the web UI. Resolves the editor from `--editor`, then the `editor` config key, then `$VISUAL`, then `$EDITOR`; exits non-zero with guidance when none is set.

```
diffwiki collection edit [name] [--editor <cmd>]
```

- `[name]` — a collection name. Omitted: the collection the current directory belongs to, else the `~/.diffwiki/collections` root.
- `--editor <cmd>` — editor command to use (overrides config `editor`, `$VISUAL`, `$EDITOR`). Split on whitespace, so `code -w` works.

```
diffwiki collection edit handbook             # open the collection directory
diffwiki collection edit --editor "code -w"   # override the configured editor
```

## Articles

Article commands mutate markdown files inside a collection. The identifier is a **positional** `collection:slug` (the deprecated aliases kept it on `-p/--path`). For `article create` the collection is optional (`[collection:]title`) and falls back to `defaultCollection`. See [contributing](/user-guide/continuous-learning).

### `article create "<[collection:]title>" [body]`

Add an article to a collection. Prints the created file path.

```
diffwiki article create "<[collection:]title>" [body] [-t <tag>...]
```

- `<target>` (required) — positional `"[collection:]title"`.
- `[body]` — markdown body. Defaults to a `# <title>` heading when omitted.
- `-t, --tag <tag>` — tag; repeatable and comma-separated. Default: `[]`.

```
diffwiki article create "handbook:Onboarding" "# Onboarding" -t hr,process
```

### `article update "<collection:slug>" <body>`

Replace an article's body (frontmatter title/tags/audience/status are preserved).

```
diffwiki article update "<collection:slug>" <body>
```

- `<target>` (required) — positional `"collection:slug"`.
- `<body>` (required) — the new markdown body.

```
diffwiki article update "handbook:onboarding" "# Onboarding\nUpdated."
```

### `article remove "<collection:slug>"`

Delete an article file.

```
diffwiki article remove "<collection:slug>"
```

- `<target>` (required) — positional `"collection:slug"`.

```
diffwiki article remove "handbook:onboarding"
```

### `article edit "<collection:slug>"`

Open a single article in your editor. Resolves the editor from `--editor`, then the `editor` config key, then `$VISUAL`, then `$EDITOR`; exits non-zero with guidance when none is set.

```
diffwiki article edit "<collection:slug>" [--editor <cmd>]
```

- `<target>` (required) — positional `"collection:slug"`.
- `--editor <cmd>` — editor command to use (overrides config `editor`, `$VISUAL`, `$EDITOR`). Split on whitespace, so `code -w` works.

```
diffwiki article edit "handbook:onboarding"              # open one article file
diffwiki article edit "handbook:onboarding" --editor "code -w"
```

## Tags

Tag commands mutate a single article's tags. The identifier is a **positional** `collection:slug` (the deprecated aliases kept it on `-p/--path`).

### `tags add "<collection:slug>" <tags>` / `tags remove "<collection:slug>" <tags>` / `tags set "<collection:slug>" <tags>`

Mutate an article's tags: `tags add` unions, `tags remove` subtracts, `tags set` replaces the whole set. Each prints the resulting tag list.

```
diffwiki tags add    "<collection:slug>" <tags>
diffwiki tags remove "<collection:slug>" <tags>
diffwiki tags set    "<collection:slug>" <tags>
```

- `<target>` (required) — positional `"collection:slug"`.
- `<tags>` (required) — comma-separated tags.

```
diffwiki tags add "handbook:onboarding" hr,onboarding
```

## Search

diffwiki ships a built-in native BM25 search and can route to installed search plugins. See [search & RAG](/user-guide/search-and-rag).

### `search index`

Rebuild the search index via the active plugin. No-op (with a hint) when no index-backed plugin is installed — native search needs no index.

```
diffwiki search index [--embed]
```

- `--embed` — also build vector embeddings (may download models on first run).

```
diffwiki search index --embed
```

### `search query [term]`

Search articles via the resolved search engine, falling back to native BM25 when no engine is set or the engine fails. Prints one tab-separated line per hit: `score  collection  title  path  [snippet]`. Short alias: `diffwiki search q`.

```
diffwiki search query [--engine <name>] [-c <name>] [-t <type>] [term]
```

- `--engine <name>` — search engine/plugin. Default: config `defaultSearch`, else `native`.
- `-c, --collection <name>` — limit to a single collection.
- `-t, --type <type>` — search type (engine-defined, e.g. `keyword|semantic|hybrid`).
- `[term]` — search term. Default: `""` (empty term browses all articles unranked).

```
diffwiki search query --engine diffwiki-qmd -t semantic "vector databases"
diffwiki search q "vector databases"
```

## Plugins

Manage external search plugins. See the [Plugin SDK](/api-docs/plugins) for the protocol.

### `plugin install <spec>`

Install a search plugin from an npm spec into the managed plugin root and provision it (run its `setup`). By default the new plugin becomes the default search engine.

```
diffwiki plugin install <spec> [--no-setup] [--no-default] [--prefetch-models]
```

- `<spec>` (required) — npm package spec: `name`, `name@version`, or a local path.
- `--no-setup` — skip the end-to-end setup after install (run `diffwiki search index` later).
- `--no-default` — do not make this the default search engine.
- `--prefetch-models` — pre-download models during setup (heavy).

```
diffwiki plugin install diffwiki-qmd
```

### `plugin register <name> --command <cmd...>`

Register an already-installed executable as a search plugin without touching npm (registered as unmanaged, so `remove` won't `npm uninstall`).

```
diffwiki plugin register <name> --command <cmd...>
```

- `<name>` (required) — plugin name.
- `--command <cmd...>` (required) — command argv to spawn the plugin.

```
diffwiki plugin register my-plugin --command node /abs/adapter.js
```

### `plugin list`

List installed plugins (with kind, version, and enabled/managed/spawnable flags) and available plugins from the built-in catalog.

```
diffwiki plugin list
```

### `plugin remove <name>`

Remove a search plugin. For managed plugins this also runs `npm uninstall` in the managed root.

```
diffwiki plugin remove <name>
```

- `<name>` (required) — plugin name.

```
diffwiki plugin remove diffwiki-qmd
```

## Site

Build a static site or preview it locally. See [sharing](/user-guide/sharing).

### `site export`

Generate a static site deployable to GitHub Pages. Exports the global collections by default, or a single repo project with `--project`.

```
diffwiki site export -o <dir> [-b <path>] [-f <globs>] [-e <globs>] [--project [dir]]
```

- `-o, --out <dir>` (required) — output directory.
- `-b, --base <path>` — base URL path (e.g. `/my-repo/` for GitHub Pages). Default: `/`.
- `-f, --filter <globs>` — only export collections matching these globs (comma-separated).
- `-e, --exclude <globs>` — exclude collections matching these globs (comma-separated).
- `--project [dir]` — build only the repo project from its `diffwiki.yaml`. Default dir: cwd.

```
diffwiki site export -o ./site -b /my-repo/ -f "docs,handbook"
```

### `site preview`

Preview the site built from the repo's `diffwiki.yaml`, ignoring global collections.

```
diffwiki site preview [-p <port>]
```

- `-p, --port <port>` — port to serve on. Default: `4321`.

```
diffwiki site preview -p 4321
```

## UI

Run the local diffwiki app server. See [sharing](/user-guide/sharing).

### `ui up`

Start the diffwiki UI (latest published `diffwiki-app`). No-op if already running.

```
diffwiki ui up [-p <port>]
```

- `-p, --port <port>` — port to serve on. Default: `4321`.

```
diffwiki ui up
```

### `ui down`

Stop the running diffwiki UI.

```
diffwiki ui down
```

### `ui status`

Show whether the diffwiki UI is running (prints `running · <url> · pid … · since …` or `stopped`).

```
diffwiki ui status
```

### `ui open`

Open the diffwiki UI in the browser, starting it first if needed. When the current directory belongs to a collection, opens that collection's page.

```
diffwiki ui open [-p <port>]
```

- `-p, --port <port>` — port to serve on. Default: `4321`.

```
diffwiki ui open
```

## Config

Read and write persisted config (`~/.diffwiki/config.json`).

### `config set <key> <value>`

Set a config value. `defaultCollection` must name a registered collection (validated). `defaultSearch` takes an `engine[:type]` string and is stored unconditionally (a warning prints when the engine is not installed/enabled).

```
diffwiki config set <key> <value>
```

- `<key>` (required) — config key (e.g. `defaultCollection`, `defaultSearch`, `editor`).
- `<value>` (required) — config value.

```
diffwiki config set defaultSearch diffwiki-qmd:hybrid
diffwiki config set editor "code -w"        # used by `diffwiki collection edit` / `diffwiki article edit`
```

### `config get <key>`

Read a config value. Prints `(unset)` when absent.

```
diffwiki config get <key>
```

- `<key>` (required) — config key.

```
diffwiki config get defaultCollection
```

## Diagnostics

### `doctor`

Diagnose configuration issues: home directory, registry, collection paths, default collection, and every registered plugin's readiness. Exits non-zero when any diagnostic is an error.

```
diffwiki doctor
```

No options. Example:

```
diffwiki doctor
```
