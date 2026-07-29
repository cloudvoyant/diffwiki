---
title: Plugin SDK
tags:
  - plugins
  - reference
order: 3
---

# Plugin SDK

Plugins extend diffwiki with external search engines. The only plugin kind supported today is `search`. Each plugin is a standalone Node.js executable that speaks a one-shot JSON-over-stdio protocol with the host (`diffwiki-core`). The host never keeps a persistent child alive: every operation is a fresh subprocess that reads one request from stdin, writes one response to stdout, and exits.

Two official plugins ship in the monorepo — `diffwiki-qmd` (keyword, semantic, and hybrid search via the `qmd` CLI) and `diffwiki-ripgrep` (instant literal/regex search via `rg`). Third-party plugins follow the same protocol. See [search & RAG](/user-guide/search-and-rag) for the user-facing view.

## SDK / host boundary

Plugin authors import only from the authoring SDK — the `diffwiki-core/plugin` subpath export. That module is self-contained: it imports no host-side code (filesystem, registry, config, query routing), so plugin binaries stay slim and independent of host internals. The host side (subprocess invocation, registry persistence, search-mode discovery, event emission) lives in `diffwiki-core`'s plugin manager and is never imported by plugin authors.

## Wire protocol

Every interaction is a single request/response cycle over stdin/stdout. The host writes one JSON line to the plugin's stdin and closes it; the plugin writes exactly one JSON response line to stdout and exits. Diagnostic log lines go to stderr as structured `{"log":{"level","message"}}` lines, which the host forwards to a LogTape logger scoped to the plugin name.

Request:

```json
{"op": "search", "params": { }}
```

Success:

```json
{"ok": true, "result": { }}
```

Error:

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

- **`searchTypes`** — the search-type strings the plugin accepts (e.g. `['keyword','semantic','hybrid']` for `diffwiki-qmd`, `['text','regex']` for `diffwiki-ripgrep`). Each becomes a selectable mode in the UI and CLI.
- **`collectionFilter`** — whether the plugin honours a `collection` param to scope results to one collection.
- **`events`** — whether the plugin implements `event` and wants incremental notifications on content mutations.

Capabilities are cached in `~/.diffwiki/plugins.json` at install/register time so the host can enumerate search modes without spawning anything on every page load.

## Authoring a plugin

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

`definePlugin` implements the protocol dispatch: it reads one JSON request from stdin, calls the matching handler, writes the JSON response to stdout, and exits. The `log` function emits `{"log":{"level","message"}}` lines to stderr for the host to forward. Optional handlers (`index`, `setup`, `onEvent`, `health`) default to no-ops when omitted. Only `search` is required for a search plugin.

For the binary to be auto-discoverable by `diffwiki plugin install`, the package's `package.json` must declare `"diffwiki": {"kind": "search"}` and a `"bin"` entry.

### SDK helpers

The SDK also exports subprocess and dependency-resolution utilities for plugins that drive external CLIs:

- `runProcess(file, args, opts?)` — promisified `execFile` with large-buffer defaults; returns `{ stdout, stderr }`.
- `runProcessJson<T>(file, args, opts?)` — run a command and JSON-parse its stdout.
- `commandExists(name)` — `true` when `<name> --version` exits successfully.
- `resolveDependency(dep, fromUrl)` — resolve a declared `PluginDependency` to an argv prefix, preferring the npm-local bin (looked up relative to `fromUrl` = the plugin bin's `import.meta.url`) then the bare command on PATH. Returns `{ command, source: 'npm' | 'path' | 'missing' }`.

## Dependency resolution

A plugin declares its external-tool dependencies as `PluginDependency` objects — each with a `command` (executable name), optional `npm` package name, and a human-readable `hint`. `resolveDependency` resolves in order:

1. **npm-local bin** — when `dep.npm` is set, walk the `node_modules` chain up from the plugin binary's own file URL to find the package's `package.json` `bin` entry. This lets a dependency pulled transitively by `diffwiki plugin install` be used with no global install.
2. **PATH** — fall back to the bare command name if it is on PATH.

A `null` command means the dependency is unresolvable; the plugin should report this via `setup` and `health`.

## Install & default flow

`diffwiki plugin install <spec>` installs the npm package into an isolated managed root at `~/.diffwiki/plugins/`, then:

1. Resolves the package **name** from the spec and targets that specific package (requiring `diffwiki.kind === "search"` and a `bin`). Targeting the installed package — not the first search package found — is what lets **multiple search plugins coexist**.
2. Runs `describe` to validate the plugin and caches its capabilities.
3. Writes a `PluginRecord` (`{name, kind, command, version, capabilities, enabled:true, managed:true}`) to `~/.diffwiki/plugins.json`.
4. Runs `setup` with the current collections (best-effort — a failure leaves the plugin registered but not-ready; search degrades to native until resolved).
5. Unless `--no-default` is passed (and unless `setup` reported not-ready), sets the plugin as the default engine via `config.defaultSearch`.

`diffwiki plugin register <name> --command <argv>` registers an already-installed binary without npm (from step 2 onward, `managed:false`). Set or change the default at any time:

```
diffwiki config set defaultSearch diffwiki-qmd:hybrid
```

The `engine[:type]` value picks the engine and, optionally, one of its advertised `searchTypes`. `diffwiki plugin remove <name>` deregisters the plugin and, for managed plugins, runs `npm uninstall` in the managed root.

## Incremental indexing (events)

When a plugin sets `capabilities.events: true`, the host fires a best-effort `event` op after every content mutation (article create/update/remove, collection add/remove). The call is fire-and-forget — every error is swallowed and the mutation never waits on the plugin. The correctness path remains the mtime-staleness lazy reindex on `search`, so a dropped event costs a later rebuild, never wrong results.

## Registry persistence

`~/.diffwiki/plugins.json` is the single source of truth for registered plugins: each record's name, kind, command argv, version, cached capabilities, enabled flag, and whether it is managed. The host reads this file to enumerate search modes, resolve the default engine, and decide which plugins to spawn. A missing file means an empty registry (native-only mode).

For the full CLI surface, see the [CLI Reference](/api-docs/cli); for the host-side API, see [diffwiki-core](/api-docs/core).
