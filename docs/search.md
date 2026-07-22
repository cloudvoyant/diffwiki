# Search Architecture

> Focused reference for the diffwiki search system. See also [plugins.md](plugins.md) for the plugin protocol and lifecycle, and [architecture.md](architecture.md) for the broader system design.

## Overview

All search flows through `search(term, opts)` and the lower-level `query(term, opts)` in `packages/diffwiki-core/src/query.ts`. The function resolves the search engine, runs the search, falls back to native BM25 on any failure, and returns a `SearchOutcome` that tells callers which engine ran and whether a fallback occurred.

Three engine families are available: the native BM25 engine built into `diffwiki-core`, the `diffwiki-qmd` plugin (keyword, semantic, and hybrid via the `qmd` CLI), and the `diffwiki-ripgrep` plugin (instant literal/regex via `rg`). Native BM25 is always present and is the fallback if any plugin engine fails or is unavailable.

## Engine Routing

`search()` picks an engine in strict precedence order:

1. **Explicit `opts.engine`** — the caller names an engine directly (used by the web UI when the user selects a mode from the dropdown, or by the CLI with `--engine`).
2. **`config.defaultSearch`** — the `~/.diffwiki/config.json` field `defaultSearch`, a `"<plugin>[:<type>]"` string. The plugin name is extracted and checked against the enabled plugin list. If it names an enabled plugin, that plugin wins.
3. **First enabled plugin** — the first plugin in `~/.diffwiki/plugins.json` with `enabled: true` and `kind: "search"`.
4. **Native BM25** — the built-in zero-dependency engine.

On any engine failure — no provider found, or the `handleSearch` call throws — the error message is captured, native BM25 is run as the fallback, and the `SearchOutcome` reports `{fellBackToNative: true, error}`. This lets callers distinguish "the engine errored" from "the engine found nothing legitimately". `query()` is a thin wrapper over `search()` that drops the outcome metadata and returns just the hits.

`resolveDefaultSearchMode()` computes the same engine+type selection (including the configured type suffix) but reads cached capabilities from the plugin registry rather than spawning — used by the web UI to pre-select the dropdown to the engine that would actually run.

## Native BM25 Engine

The native engine is a zero-dependency, cross-platform full-text search implemented directly in `diffwiki-core`. It walks every registered collection's absolute filesystem path, parses frontmatter from each `.md` / `.mdx` file, tokenises four fields, and scores with BM25 (K1=1.5, B=0.75):

| Field | Weight |
|---|---|
| `title` | ×3.0 |
| `tags` | ×2.0 |
| `collection` | ×1.5 |
| `body` | ×1.0 |

IDF is computed per query term across the corpus; per-field term frequencies are summed with their weights into a single document score. Results are returned sorted by score descending. An empty term returns all articles unranked (browse-all behaviour). No shell commands or OS tools are involved, so it works cross-platform with no external dependencies.

The native engine score is an unbounded weighted BM25 sum — there is no fixed scale; relative ordering within a result set is what matters.

## diffwiki-qmd Plugin

`diffwiki-qmd` provides keyword, semantic, and hybrid search backed by the `qmd` CLI. Each search type maps to a different qmd subcommand (cold path) and a different query spec (warm path):

| diffwiki type | Cold CLI subcommand | Warm `searches` + `rerank` |
|---|---|---|
| `keyword` | `qmd search` | `[{type:'lex',query}]`, `rerank:false` |
| `semantic` | `qmd vsearch` | `[{type:'vec',query}]`, `rerank:false` |
| `hybrid` | `qmd query` | `[{type:'lex',query},{type:'vec',query}]`, `rerank:true` |

### Index Storage and Staleness

qmd stores its index as a SQLite file at `~/.diffwiki/qmd/qmd/diffwiki.sqlite` (XDG dirs are relocated under `~/.diffwiki/qmd` so qmd's own state is isolated from any independent use of `qmd` outside diffwiki). qmd runs in WAL mode, so committed writes land in the `.sqlite-wal` sidecar; staleness detection checks the mtime of all three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`) and takes the newest — otherwise the frozen base mtime would trigger a spurious reindex on every search.

Before each search, the plugin compares the newest mtime of all markdown files in the collection roots against the index mtime. If content is newer, it runs `qmd update` to pull in the changes. For semantic or hybrid searches, it additionally checks `qmd status` and runs `qmd embed` if any documents still have pending embeddings. This staleness check is best-effort and entirely skipped if the warm daemon is currently up (see below), because a concurrent CLI write while the daemon holds the SQLite connection can corrupt the FTS index.

### Warm Daemon

For semantic and hybrid searches, loading the GGUF embedding model is expensive. `diffwiki-qmd` keeps models resident in a long-lived `qmd mcp --http --daemon --index diffwiki` process that it starts on first search and leaves running. Subsequent searches reach the daemon over HTTP using two MCP JSON-RPC round-trips (initialize → tools/call name=query) rather than spawning a fresh CLI process and loading models from scratch.

diffwiki uses a private port (`8191` by default, overridable via `DIFFWIKI_QMD_MCP_PORT`) and a private index name (`diffwiki`) so it never collides with a qmd daemon a user may already be running for their own purposes. diffwiki only ever *starts* the daemon — it never stops or kills it, keeping it a cooperative client. The daemon is spawned fully detached (`detached:true`, `stdio:'ignore'`, `.unref()`) so it survives the one-shot plugin process exiting.

If the daemon probe (`GET /health`) fails, or warm mode is disabled (`DIFFWIKI_QMD_WARM=0`), the plugin falls back to the cold CLI path (`qmd search` / `qmd vsearch` / `qmd query --format json`). The cold path always works; warm mode is a pure latency optimisation.

qmd scores results on a 0–1 scale for vector searches; lexical scores are BM25-based and unbounded. Hybrid mode applies a reranker that normalises to 0–1.

### Event Handling

`diffwiki-qmd` sets `capabilities.events: true` and implements the `event` op by running `qmd update --index diffwiki -c <collection>` on each mutation. This keeps the keyword index current without a full reindex. Events are best-effort; a dropped event triggers a lazy rebuild on the next search.

## diffwiki-ripgrep Plugin

`diffwiki-ripgrep` provides instant literal and regex search via the `rg` (ripgrep) binary. It needs no index, no embedding models, and no setup beyond `rg` being available on PATH. Its `setup` op only verifies `rg --version`. `index` and `onEvent` are no-ops.

| diffwiki type | rg flag |
|---|---|
| `text` (default) | `--fixed-strings` |
| `regex` | _(no flag — rg's default)_ |

The plugin spawns `rg --json -g '*.md' -g '*.mdx'` across all collection roots, parses the JSON match stream, deduplicates by file path, and resolves each match to a `{collection, relPath}` by prefix-matching the absolute file path against the collection list (longest path first, to handle nested collections correctly). The first line of the file is used as a cheap title fallback.

ripgrep results carry no score; the `score` field is omitted from hits. Results are returned in the order `rg` produces them (roughly: collection root order, then file discovery order within each root).

## Search Mode Discovery

`listSearchModes()` in the plugin loader returns the complete list of available engines and types. It always starts with the native mode (`{plugin:'native', type:'basic', label:'native · bm25'}`), then appends one entry per `searchType` per enabled plugin, reading cached capabilities from `~/.diffwiki/plugins.json` rather than spawning any plugins. This makes it safe to call on every web page load.

The web UI's search mode dropdown is populated by the `getSearchModes` server function, which calls `listSearchModes()` and `resolveDefaultSearchMode()` in parallel and returns both — the dropdown renders all modes and pre-selects the one `query()` would actually pick, so what the user sees is consistent with what will run.

## Web Search Route

The `/search` route in `apps/wiki` calls the `runSearch` server function with `{q, collection?, engine?, type?}`. The server function:

1. Short-circuits on a blank query (instant empty response, so the `/search` landing page is fast).
2. Calls `search(q, {engine, collection, type})` and `listCollections()` in parallel.
3. Maps each `QueryHit` to a `SearchResultItem` via `hitToResult`, which resolves the owning collection by prefix-matching the hit's absolute path against the registered collection list (name alone is insufficient for in-repo wikis that live outside `~/.diffwiki`).
4. Returns `{q, results, tookMs, engineError?}`. When the engine failed and native BM25 produced the results, `engineError` is set to the captured failure message so the UI can show a warning.

The `engineError` field is the only way the web UI learns that a fallback occurred — the hits themselves look identical whether they came from the intended engine or from native BM25.

## Doctor Integration

`diffwiki doctor` calls the `health` op on each enabled search plugin to report readiness. The `HealthHandlerResult` includes a `readiness` object with structured flags (`toolInstalled`, `modelsPresent`, `indexBuilt`, `docsIndexed`, `embeddingsPending`, `firstSearchCost`) and an array of human-readable `diagnostics` entries tagged `ok`, `warn`, or `error`. `diffwiki-qmd` also probes the warm daemon and includes its status in the diagnostics.
