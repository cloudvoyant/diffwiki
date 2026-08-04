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

IDF is computed per query term across the corpus; per-field term frequencies are summed with their weights into a single raw document score. The raw scores are then **normalized to (0, 1] by dividing by the top score** (best hit = 1, others proportional), so native results show a 0-1 relevance badge consistent with the plugin engines. Division-by-max is used rather than min-max so a dominant top hit stays near 1 while weak matches stay low. Results are returned sorted by score descending. An empty term returns all articles unranked (browse-all behaviour). No shell commands or OS tools are involved, so it works cross-platform with no external dependencies.

The normalized scale is **per-result-set, not comparable across queries** (a top hit is always 1) — the same caveat as every engine's score. This normalization lives in the shared `rankDocs` scorer, so the CLI and the static browser search stay identical.

## diffwiki-qmd Plugin

`diffwiki-qmd` provides keyword, semantic, and hybrid search backed by the `qmd` CLI. Each search type maps to a different qmd subcommand (cold path) and a different query spec (warm path):

| diffwiki type | Cold CLI subcommand | Warm `searches` + `rerank` |
|---|---|---|
| `keyword` | `qmd search` | `[{type:'lex',query}]`, `rerank:false` |
| `semantic` | `qmd vsearch` | `[{type:'vec',query},{type:'hyde',query}]`, `rerank:false` |
| `hybrid` | `qmd query` | `[{type:'lex',query},{type:'vec',query},{type:'hyde',query}]`, `rerank:true` |

### Query Expansion and Parity

qmd's best results come from **query expansion**: before searching, its cold CLI runs a small local generation model (`qmd-query-expansion-1.7B`) to rewrite a query into typed variants — `lex` (BM25 keywords), `vec` (a semantic question), and `hyde` (a hypothetical answer passage) — then fuses and reranks across all of them. This matters most for short or vague queries.

The warm daemon's MCP `query` tool does **not** expose this expansion — it only accepts caller-supplied `searches` and skips qmd's `expandQuery()` step. To recover most of the quality, the plugin always appends a `hyde` variant (see the table above) so the warm path isn't reranking a thin candidate set.

Callers can also **supply their own expansion**, which is strictly better than qmd's 1.7B model when an LLM is already in the loop. `QueryOptions.expansions` (CLI: repeatable `--lex` / `--vec` / `--hyde` on `diffwiki search query`) flows through the plugin protocol as `SearchParams.expansions`; when present, those variants become the qmd `searches` (warm) or a structured `qmd query` document (cold), and the bare term is passed only as ranking intent. The `dw-recall` skill uses this: the agent expands the query itself before searching.

> **UI parity gap.** The browser search UI (and static exports) have no LLM, so they can't do agent-driven expansion — they send the raw query and rely on qmd's built-in `hyde` approximation. As a result, **short/terse queries rank noticeably better through agent recall (`dw-recall`) than through the web UI.** Closing this fully needs either an upstream qmd daemon expand endpoint or a resident expansion model in the wiki server; until then, the UI is "good for normal queries, weaker on terse ones."

### Index Storage and Staleness

qmd stores its index as a SQLite file at `~/.diffwiki/qmd/qmd/diffwiki.sqlite` (XDG dirs are relocated under `~/.diffwiki/qmd` so qmd's own state is isolated from any independent use of `qmd` outside diffwiki). qmd runs in WAL mode, so committed writes land in the `.sqlite-wal` sidecar; staleness detection checks the mtime of all three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`) and takes the newest — otherwise the frozen base mtime would trigger a spurious reindex on every search.

Before each search, the plugin compares the newest mtime of all markdown files in the collection roots against the index mtime. If content is newer, it runs `qmd update` to pull in the changes. For semantic or hybrid searches, it additionally checks `qmd status` and runs `qmd embed` if any documents still have pending embeddings. This staleness check is best-effort and entirely skipped if the warm daemon is currently up (see below), because a concurrent CLI write while the daemon holds the SQLite connection can corrupt the FTS index.

### Warm Daemon

For semantic and hybrid searches, loading the GGUF embedding model is expensive. `diffwiki-qmd` keeps models resident in a long-lived `qmd mcp --http --daemon --index diffwiki` process that it starts on first search and leaves running. Subsequent searches reach the daemon over HTTP using two MCP JSON-RPC round-trips (initialize → tools/call name=query) rather than spawning a fresh CLI process and loading models from scratch.

diffwiki uses a private port (`8191` by default, overridable via `DIFFWIKI_QMD_MCP_PORT`) and a private index name (`diffwiki`) so it never collides with a qmd daemon a user may already be running for their own purposes. diffwiki only ever *starts* the daemon — it never stops or kills it, keeping it a cooperative client. The daemon is spawned fully detached (`detached:true`, `stdio:'ignore'`, `.unref()`) so it survives the one-shot plugin process exiting.

If the daemon probe (`GET /health`) fails, or warm mode is disabled (`DIFFWIKI_QMD_WARM=0`), the plugin falls back to the cold CLI path (`qmd search` / `qmd vsearch` / `qmd query --format json`). The cold path always works; warm mode is a pure latency optimisation.

qmd scores results on a 0–1 scale for vector searches; lexical scores are BM25-based and unbounded. Hybrid mode applies a reranker that normalises to 0–1.

Each hit's `bestChunk` is the raw markdown source of the best-matching chunk. Before it is returned as the hit `snippet`, `rowsToHits` runs it through `sanitizeSnippet` (`packages/diffwiki-qmd/src/snippet.ts`), which strips markdown structure — code fences, heading markers, emphasis, links, blockquotes, table pipes, and embedded newlines — down to plain prose, collapses whitespace to a single line, and truncates to ~200 characters. Because this happens in the shared `rowsToHits` mapper, both the cold CLI path and the warm MCP path emit clean, readable snippets to every consumer (CLI, wiki UI).

### Event Handling

`diffwiki-qmd` sets `capabilities.events: true` and implements the `event` op by running `qmd update --index diffwiki -c <collection>` on each mutation. This keeps the keyword index current without a full reindex. Events are best-effort; a dropped event triggers a lazy rebuild on the next search.

## diffwiki-ripgrep Plugin

`diffwiki-ripgrep` provides instant, index-free search by combining two CLI tools: `rg` (ripgrep) and `fzf`. It has a single search type, **`fuzzy`**. There is no index and no embedding model.

The search runs in two stages:

1. **ripgrep (recall).** The query is tokenized into words; the plugin runs `rg --line-number --no-heading --with-filename --smart-case --max-count <limit> -g '*.{md,mdx}' -e '<tok1|tok2|…>'` across the collection roots. The OR-alternation means a line matching *any* token is a candidate — high recall, word-order-independent (unlike the old fixed-strings mode).
2. **fzf (ranking).** The `path:line:text` candidates are piped to `fzf --filter "<query>"`. fzf's extended-search mode ANDs each space-separated term (fuzzily, typo-tolerant) and orders results best-first.

Candidates are then parsed, deduplicated by file path (keeping the best-ranked line per file), and resolved to `{collection, relPath}` by longest-prefix matching the absolute path against the collection list. A cheap title (frontmatter `title:` → first heading → filename) is attached.

**fzf is recommended, not required.** If fzf is not on PATH (or fails), the plugin falls back to ripgrep's order — search still works, just without fuzzy ranking. `setup` **auto-installs** `rg` and `fzf` via a detected package manager (see below), then verifies them: `rg` is required (hard failure if it still can't be resolved), `fzf` is a `verify-fzf` step that warns but does not block. `health`/`doctor` report `rg` and, when rg is present, an `ok`/`warn` line for `fzf`. `index` and `onEvent` are no-ops.

When fzf ranks the results, each hit gets a rank-derived `score` in (0, 1] (best = 1, descending) so the UI shows a relevance badge consistent with the other engines. On the plain-ripgrep fallback (no fzf), result order is file-discovery order rather than relevance, so `score` is omitted.

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

`diffwiki doctor --fix` re-provisions each enabled plugin (`repairPlugins()` → the plugin's `setup` op), which auto-installs missing tools before re-diagnosing.

### Tool auto-install (`ensureTool`)

The plugin SDK exports `ensureTool(spec, { install })` — a best-effort installer for system dependencies. Given a tool's package ids per manager, it detects an available manager in order (**mise**, then **Homebrew**) and installs; `apt` is never auto-run (it needs `sudo`) and is surfaced as a guidance message instead. It's a no-op when the tool already exists, and returns `{ present, installed, method, message }` (a tool installed via mise may report `installed: true, present: false` until the shell is restarted so the shims are active). Both plugins call it from `setup`: `diffwiki-ripgrep` installs `rg` + `fzf`; `diffwiki-qmd` installs `qmd` (via mise's `npm:@tobilu/qmd` backend) when the npm-local binary is missing. The qmd binary normally rides in as the plugin's npm dependency, so this is a fallback for a manual registration or a broken install.
