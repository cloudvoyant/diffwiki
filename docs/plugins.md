# Plugin Architecture

> Focused reference for the diffwiki plugin subsystem. See also [search.md](search.md) for how search engines consume plugins, and [architecture.md](architecture.md) for the broader system design.

## Overview

Plugins extend diffwiki with external search engines. The only plugin kind supported today is `search`. Each plugin is a standalone Node.js executable that speaks a one-shot JSON-over-stdio protocol with the host (`diffwiki-core`). The host never keeps a persistent child process alive; every operation is a fresh subprocess invocation that reads one request from stdin, writes one response to stdout, and exits.

Two official plugins ship in the monorepo: `diffwiki-qmd` (keyword, semantic, and hybrid search via the `qmd` CLI) and `diffwiki-ripgrep` (instant literal/regex search via `rg`). Third-party plugins follow the same protocol.

## The SDK / Host Boundary

Plugin authors import only from the authoring SDK — the `diffwiki-core/plugin` subpath export (`packages/diffwiki-core/src/plugin.ts`). This module is deliberately self-contained: it does not import any host-side code (filesystem, registry, config, query routing), so plugin binaries stay slim and independent of host internals.

The host side lives in `packages/diffwiki-core/src/plugins/`. It owns subprocess invocation, registry persistence, lifecycle management, search-mode discovery, and event emission. Plugin authors never import from that tree.

## Wire Protocol

Every plugin interaction is a single request/response cycle over stdin/stdout. The host writes one JSON line to the plugin's stdin and closes it; the plugin writes exactly one JSON response line to stdout and exits. Diagnostic log lines emitted by the plugin go to its stderr as structured `{"log":{"level":"info","message":"..."}}` lines, which the host parses as they arrive and forwards to a LogTape logger scoped to the plugin name (`['plugin', <name>]`). Non-JSON stderr lines and raw stderr are accumulated for error context but otherwise ignored.

**Request shape:**
```json
{"op": "search", "params": { ... }}
```

**Success response:**
```json
{"ok": true, "result": { ... }}
```

**Error response:**
```json
{"ok": false, "error": {"message": "something went wrong"}}
```

### Operations

| Op | Params | Result | Notes |
|---|---|---|---|
| `describe` | _(none)_ | `{name, kind, version, capabilities, dependencies}` | Required. Validates the plugin and returns cached capabilities. |
| `search` | `{term, collections, collection?, type?, limit?}` | `{hits: [{collection, relPath, title, snippet?, score?, docid?, tags?}]}` | Required for search plugins. |
| `index` | `{collections, embed?}` | `{indexed: N}` | Optional. Full reindex; `embed:true` triggers embedding. |
| `setup` | `{collections, embed?, prefetchModels?}` | `{ready, steps:[{step, ok, message?}]}` | Optional. Initial provisioning on install/register. |
| `event` | `{event, collection, relPath?, collections}` | `{accepted}` | Optional. Incremental lifecycle hook on content mutation. |
| `health` | `{collections}` | `{ready, readiness?, diagnostics:[]}` | Optional. Readiness check for `diffwiki doctor`. |

**Timeouts:** `describe`, `health`, and `event` share a 30-second timeout. `search` allows 120 seconds (a cold first search may trigger a lazy reindex). `setup` and `index` allow 30 minutes (model download + full corpus embedding).

## Capabilities

Every plugin advertises its capabilities via `describe`:

- **`searchTypes`** — the search type strings the plugin accepts (e.g. `['keyword', 'semantic', 'hybrid']` for `diffwiki-qmd`, `['text', 'regex']` for `diffwiki-ripgrep`). Each becomes a selectable mode in the UI and CLI.
- **`collectionFilter`** — whether the plugin honours a `collection` param to scope results to a single collection.
- **`events`** — whether the plugin implements `event` and wants incremental notifications on content mutations.

Capabilities are cached in `~/.diffwiki/plugins.json` at install/register time so the host can enumerate search modes without spawning anything on every page load.

## Plugin Lifecycle

### Install

`diffwiki plugin install <spec>` installs an npm package into an isolated managed root at `~/.diffwiki/plugins/` (an independent `package.json`; not entangled with any project's `node_modules`). After the npm install:

1. The host scans `node_modules` for a package whose `package.json` has `diffwiki.kind === "search"` and a `bin` entry.
2. It runs `describe` to validate the plugin responds and caches its capabilities.
3. It writes a `PluginRecord` (`{name, kind, command, version, capabilities, enabled:true, managed:true}`) to `~/.diffwiki/plugins.json`.
4. It runs `setup` with the current collection list (best-effort; a setup failure leaves the plugin registered but not yet ready — search degrades to native until resolved).

### Register

`diffwiki plugin register <name> --command <argv>` registers an already-installed binary (e.g. a dev build, a global install) without touching npm. The flow is identical to install from step 2 onward, with `managed:false` so `remove` does not attempt `npm uninstall`.

### Setup

The `setup` op is where a plugin provisions itself: it verifies its external tool is present, registers the current collections with its indexer, builds an initial index, and optionally pre-downloads embedding models. Each step is reported as `{step, ok, message?}` in the result. A failed `setup` is captured and reported rather than aborting the registration — the plugin stays enabled and `diffwiki doctor` surfaces the issue.

### Remove

`diffwiki plugin remove <name>` deregisters the plugin from `~/.diffwiki/plugins.json` and, for managed plugins, runs `npm uninstall` in the managed root.

### Enable / Disable

`diffwiki plugin enable/disable <name>` flips `enabled` in the registry without deregistering. A disabled plugin is never loaded or spawned.

## Dependency Declaration and Resolution

A plugin declares its external tool dependencies in its `PluginDefinition` as an array of `PluginDependency` objects. Each dependency has a `command` (the executable name), an optional `npm` package name, and a human-readable `hint` shown when the dependency is unresolved.

The authoring SDK's `resolveDependency(dep, fromUrl)` function resolves a dependency to an argv prefix using this order:

1. **npm-local bin** — when `dep.npm` is set, walk up the `node_modules` chain from the plugin binary's own file URL (`import.meta.url`) to find the package's `package.json` and read its `bin` field. This is how a dependency declared in the plugin's own `package.json` — pulled transitively by `diffwiki plugin install` — is used without any global install. (The standard `require.resolve('<pkg>/package.json')` is deliberately avoided: packages with an `exports` map block that subpath with `ERR_PACKAGE_PATH_NOT_EXPORTED`.)
2. **PATH** — if the npm-local bin is absent or unresolvable, fall back to the bare command name if it's available on PATH.

The result is `{command: string[] | null, source: 'npm' | 'path' | 'missing'}`. A `null` command means the dependency is unresolvable; the plugin should report this via `setup` and `health`.

For `diffwiki-qmd`, this means `@tobilu/qmd` is listed as a regular `package.json` dependency and installs transitively — no global `npm i -g @tobilu/qmd` required. A PATH-installed `qmd` is honoured as a fallback (useful for local development where the tool is already global).

## Authoring a Plugin

Call `definePlugin(definition)` from the authoring SDK and invoke `.run()` to serve one request:

```ts
import { definePlugin, resolveDependency } from 'diffwiki-core/plugin';

definePlugin({
  name: 'my-plugin',
  kind: 'search',
  version: '1.0.0',
  capabilities: {
    searchTypes: ['text'],
    collectionFilter: true,
    events: false,
  },
  handlers: {
    async search(params, log) {
      log('info', `searching for: ${params.term}`);
      return { hits: [] };
    },
  },
}).run();
```

`definePlugin` implements the protocol dispatch: it reads one JSON request from stdin, calls the matching handler, writes the JSON response to stdout, and exits. The `log` function emits `{"log":{"level","message"}}` lines to stderr that the host forwards through LogTape. Optional handlers (`index`, `setup`, `onEvent`, `health`) default to no-ops when omitted.

For the binary to be auto-discoverable by `diffwiki plugin install`, the package's `package.json` must include `"diffwiki": {"kind": "search"}` and a `"bin"` entry.

## Incremental Indexing (Events)

When a plugin sets `capabilities.events: true`, diffwiki fires a best-effort `event` op after every content mutation (article create, update, remove; collection add, remove). The host calls `emitPluginEvent(event, collection, relPath)` fire-and-forget: every error is swallowed and the mutation never waits on the plugin. This lets a plugin self-update its index incrementally, but the correctness path remains the mtime-staleness lazy reindex on `search` — a dropped event costs a later lazy rebuild, never wrong results.

## Plugin Registry Persistence

`~/.diffwiki/plugins.json` is the single source of truth for registered plugins. It stores each plugin's name, kind, command argv, version, cached capabilities, enabled flag, and whether it is managed (npm-installed). The host reads this file to enumerate search modes, resolve the default engine, and decide which plugins to spawn. Missing file = empty registry (native-only mode).

## Built-in Catalog

The authoring SDK ships a built-in catalog (`catalog.ts`) of the official plugins:

| Name | Kind | Requires |
|---|---|---|
| `diffwiki-qmd` | search | `qmd` (via `@tobilu/qmd`) |
| `diffwiki-ripgrep` | search | `rg` (ripgrep on PATH) |

`diffwiki plugin list --available` reads this catalog for install suggestions. Installing still goes through `installPlugin(spec)`.
