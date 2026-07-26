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

## Collections

Collections are the top-level content units. See the [collections guide](/user-guide/collections) for concepts.

### `list`

List all registered collections with type, path, and (for external collections) the current git branch.

```
diffwiki list
```

No options. Example:

```
diffwiki list
```

### `create <name>`

Create a new global collection (stored under `~/.diffwiki/collections/<name>`).

```
diffwiki create <name>
```

- `<name>` (required) — collection name.

```
diffwiki create handbook
```

### `add`

Add the current git repo as an **external** collection — content served from a docs directory, with no `diffwiki.yaml` written. Registered globally and discoverable via `diffwiki list`.

```
diffwiki add [-d <dir>]
```

- `-d, --docs <dir>` — content dir relative to the repo root. Default: `docs`.

```
diffwiki add --docs documentation
```

### `init`

Initialize an in-repo wiki: create the wiki directory, write a `diffwiki.yaml`, and register the collection globally.

```
diffwiki init [-c <name>] [-p <path>]
```

- `-c, --collection <name>` — collection name. Default: the repo name.
- `-p, --path <path>` — wiki path within the repo. Default: `wiki`.

```
diffwiki init --collection docs --path wiki
```

## Articles

Article commands mutate markdown files inside a collection. Targets use `collection:path` (or `[collection:]title` for `add-article`, where the collection is optional and falls back to `defaultCollection`). See [contributing](/user-guide/continuous-learning).

### `add-article [body]`

Add an article to a collection. Prints the created file path.

```
diffwiki add-article -p "[collection:]title" [-t <tag>...] [body]
```

- `-p, --path <target>` (required) — `"[collection:]title"`.
- `-t, --tag <tag>` — tag; repeatable and comma-separated. Default: `[]`.
- `[body]` — markdown body. Defaults to a `# <title>` heading when omitted.

```
diffwiki add-article -p "handbook:Onboarding" -t hr,process "# Onboarding"
```

### `update-article <body>`

Replace an article's body (frontmatter title/tags/audience/status are preserved).

```
diffwiki update-article -p "collection:path" <body>
```

- `-p, --path <target>` (required) — `"collection:path"`.
- `<body>` (required) — the new markdown body.

```
diffwiki update-article -p "handbook:onboarding" "# Onboarding\nUpdated."
```

### `remove-article`

Delete an article file.

```
diffwiki remove-article -p "collection:path"
```

- `-p, --path <target>` (required) — `"collection:path"`.

```
diffwiki remove-article -p "handbook:onboarding"
```

### `add-tags <tags>` / `remove-tags <tags>` / `update-tags <tags>`

Mutate an article's tags: `add-tags` unions, `remove-tags` subtracts, `update-tags` replaces the whole set. Each prints the resulting tag list.

```
diffwiki add-tags    -p "collection:path" <tags>
diffwiki remove-tags -p "collection:path" <tags>
diffwiki update-tags -p "collection:path" <tags>
```

- `-p, --path <target>` (required) — `"collection:path"`.
- `<tags>` (required) — comma-separated tags.

```
diffwiki add-tags -p "handbook:onboarding" hr,onboarding
```

## Search

diffwiki ships a built-in native BM25 search and can route to installed search plugins. See [search & RAG](/user-guide/search-and-rag).

### `index`

Rebuild the search index via the active plugin. No-op (with a hint) when no index-backed plugin is installed — native search needs no index.

```
diffwiki index [--embed]
```

- `--embed` — also build vector embeddings (may download models on first run).

```
diffwiki index --embed
```

### `query [term]`

Search articles via the resolved search engine, falling back to native BM25 when no engine is set or the engine fails. Prints one tab-separated line per hit: `score  collection  title  path  [snippet]`.

```
diffwiki query [--engine <name>] [-c <name>] [-t <type>] [term]
```

- `--engine <name>` — search engine/plugin. Default: config `defaultSearch`, else `native`.
- `-c, --collection <name>` — limit to a single collection.
- `-t, --type <type>` — search type (engine-defined, e.g. `keyword|semantic|hybrid`).
- `[term]` — search term. Default: `""` (empty term browses all articles unranked).

```
diffwiki query --engine diffwiki-qmd -t semantic "vector databases"
```

## Plugins

Manage external search plugins. See the [Plugin SDK](/api-docs/plugins) for the protocol.

### `plugin install <spec>`

Install a search plugin from an npm spec into the managed plugin root and provision it (run its `setup`). By default the new plugin becomes the default search engine.

```
diffwiki plugin install <spec> [--no-setup] [--no-default] [--prefetch-models]
```

- `<spec>` (required) — npm package spec: `name`, `name@version`, or a local path.
- `--no-setup` — skip the end-to-end setup after install (run `diffwiki index` later).
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

## Publish & UI

Build a static site or run the local UI. See [sharing](/user-guide/sharing).

### `export`

Generate a static site deployable to GitHub Pages. Exports the global collections by default, or a single repo project with `--project`.

```
diffwiki export -o <dir> [-b <path>] [-f <globs>] [-e <globs>] [--project [dir]]
```

- `-o, --out <dir>` (required) — output directory.
- `-b, --base <path>` — base URL path (e.g. `/my-repo/` for GitHub Pages). Default: `/`.
- `-f, --filter <globs>` — only export collections matching these globs (comma-separated).
- `-e, --exclude <globs>` — exclude collections matching these globs (comma-separated).
- `--project [dir]` — build only the repo project from its `diffwiki.yaml`. Default dir: cwd.

```
diffwiki export -o ./site -b /my-repo/ -f "docs,handbook"
```

### `preview`

Preview the site built from the repo's `diffwiki.yaml`, ignoring global collections.

```
diffwiki preview [-p <port>]
```

- `-p, --port <port>` — port to serve on. Default: `4321`.

```
diffwiki preview -p 4321
```

### `up`

Start the diffwiki UI (latest published `diffwiki-app`). No-op if already running.

```
diffwiki up [-p <port>]
```

- `-p, --port <port>` — port to serve on. Default: `4321`.

```
diffwiki up
```

### `down`

Stop the running diffwiki UI.

```
diffwiki down
```

### `status`

Show whether the diffwiki UI is running (prints `running · <url> · pid … · since …` or `stopped`).

```
diffwiki status
```

### `open`

Open the diffwiki UI in the browser, starting it first if needed. When the current directory belongs to a collection, opens that collection's page.

```
diffwiki open [-p <port>]
```

- `-p, --port <port>` — port to serve on. Default: `4321`.

```
diffwiki open
```

### `edit [target]`

Open a collection (or a single article) in your editor, so you can write markdown without the web UI. Resolves the editor from `--editor`, then the `editor` config key, then `$VISUAL`, then `$EDITOR`; exits non-zero with guidance when none is set.

```
diffwiki edit [target] [--editor <cmd>]
```

- `[target]` — a collection name, or `"collection:slug"` for a single article. Omitted: the collection the current directory belongs to, else the `~/.diffwiki/collections` root.
- `--editor <cmd>` — editor command to use (overrides config `editor`, `$VISUAL`, `$EDITOR`). Split on whitespace, so `code -w` works.

```
diffwiki edit handbook             # open the collection directory
diffwiki edit handbook:onboarding  # open one article file
diffwiki edit --editor "code -w"   # override the configured editor
```

## Config

Read and write persisted config (`~/.diffwiki/config.json`).

### `config-set <key> <value>`

Set a config value. `defaultCollection` must name a registered collection (validated). `defaultSearch` takes an `engine[:type]` string and is stored unconditionally (a warning prints when the engine is not installed/enabled).

```
diffwiki config-set <key> <value>
```

- `<key>` (required) — config key (e.g. `defaultCollection`, `defaultSearch`, `editor`).
- `<value>` (required) — config value.

```
diffwiki config-set defaultSearch diffwiki-qmd:hybrid
diffwiki config-set editor "code -w"        # used by `diffwiki edit`
```

### `config-get <key>`

Read a config value. Prints `(unset)` when absent.

```
diffwiki config-get <key>
```

- `<key>` (required) — config key.

```
diffwiki config-get defaultCollection
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
