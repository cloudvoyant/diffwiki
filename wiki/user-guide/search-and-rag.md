---
title: Search & RAG
tags:
  - user-guide
  - search
  - rag
order: 4
---

# Search & RAG

Search is a first-class surface in diffwiki. Every note you or an agent writes is immediately retrievable, and the same retrieval path powers the local UI, the published site, and agent memory. Out of the box diffwiki ships a zero-dependency native engine; optional plugins add faster keyword search and semantic understanding.

## The native BM25 engine

The built-in engine is a zero-dependency, cross-platform full-text search implemented directly in `diffwiki-core`. It walks every registered [collection](/user-guide/collections), parses frontmatter from each `.md` / `.mdx` file, and scores with BM25 across weighted fields, with `title` and `tags` weighted above body text. That means disciplined [tagging](/user-guide/continuous-learning) meaningfully improves retrieval. Because nothing but plain files is involved, native search works everywhere with nothing to install, and an empty query term browses every article — the behavior the site's search landing page relies on.

## Optional search plugins

Search engines are subprocess plugins that speak a small JSON-over-stdio protocol, so an engine can be written in any language and swapped in without touching the host. Two official plugins ship in the monorepo:

- **`diffwiki-ripgrep`** — instant, index-free `fuzzy` search combining `rg` (ripgrep, for high-recall candidate lines) and `fzf` (for typo-tolerant, word-order-independent ranking). No index, no models. `rg` is required; `fzf` is recommended — without it, search still works but falls back to plain ripgrep ordering. Type: `fuzzy`.
- **`diffwiki-qmd`** — keyword, semantic, and hybrid search backed by the `qmd` CLI, with a resident embedding-model daemon for low-latency semantic queries. Types: `keyword`, `semantic`, and `hybrid`.

Install a plugin and make it the default engine:

```bash
diffwiki plugin install diffwiki-ripgrep
diffwiki plugin install diffwiki-qmd
diffwiki config set defaultSearch diffwiki-qmd:hybrid
```

The value passed to `config set defaultSearch` is `<engine>[:<type>]`, where the engine name is the plugin name — for example `diffwiki-qmd:hybrid` or `diffwiki-ripgrep:fuzzy`. `plugin install` provisions the plugin end-to-end and, unless you pass `--no-default`, sets it as the default engine. List what is installed and available with `diffwiki plugin list`.

## Querying

```bash
diffwiki search query "static export"                 # uses the resolved default engine
diffwiki search query -c user-guide "search"          # limit to a single collection
diffwiki search query --engine diffwiki-ripgrep -t fuzzy "static export config"   # pick engine + type
```

Each result line is `score  collection  title  path  [snippet]`. For qmd-backed engines the snippet is the best-matching chunk, sanitized to readable plain text — markdown structure (code fences, headings, emphasis, links) is stripped and the text is collapsed to a single line — so results stay legible in the terminal. The score scale is engine-dependent, so use it to eyeball a cutoff within a single result set rather than to compare across engines.

### Query expansion (for agents)

Semantic/hybrid search quality on short or vague queries depends heavily on *query expansion*. If you have a capable LLM in the loop (e.g. an agent running `dw-recall`), you can expand the query yourself and pass typed variants — far better than the engine's small built-in expander:

```bash
diffwiki search query "add a cli subcommand" \
  --lex "commander subcommand add-command" \
  --vec "how do I add a new CLI verb in a TypeScript Commander app" \
  --hyde "Add a subcommand by chaining .command().action() off the program factory."
```

The positional term becomes the ranking *intent*; the repeatable `--lex` / `--vec` / `--hyde` flags are the actual sub-queries. Omit them for a plain search.

> The browser search UI can't do this — it has no LLM — so short-query results in the published site are weaker than agent-driven recall. See below.

## Engine routing and automatic fallback

`search query` resolves an engine in strict precedence: an explicit `--engine`, then `config.defaultSearch`, then the first enabled search plugin, and finally the native BM25 engine. Crucially, if the chosen plugin fails or is unavailable, diffwiki captures the error and falls back to native BM25 automatically, so a search always returns results. When that happens the CLI prints a warning naming the engine that failed, so you always know whether results came from the intended engine or from the native fallback.

## Indexing

Plugins that maintain an index expose `diffwiki search index`:

```bash
diffwiki search index            # rebuild the active plugin's index
diffwiki search index --embed    # also build vector embeddings (may download models)
```

The native engine has no index to build — it reads collections live — so `diffwiki search index` reports nothing to index when native search is active. Run `diffwiki doctor` to check plugin readiness (tool installed, models present, index built, embeddings pending), or `diffwiki doctor --fix` to re-provision plugins and auto-install missing tools.

Installing a plugin (`diffwiki plugin install …`) provisions its tools automatically where it can: `diffwiki-qmd` pulls the `qmd` binary in as an npm dependency (models download on first use or with `--embed`), and `diffwiki-ripgrep` auto-installs `rg` and `fzf` via a detected package manager (mise, then Homebrew; on Debian/Ubuntu it prints the `apt` command rather than running `sudo`).

## Search in the published site

When you [publish](/user-guide/sharing), diffwiki ships the BM25 index as a static asset. The site's `/search` page runs the same BM25 ranking client-side, with no server — the scorer runs in the browser over the shipped index. That makes the published wiki's search identical to the local experience, and it works on any static host.

> **Parity note.** Neither the published static site nor the live wiki UI has an LLM available, so they can't do the agent-style query expansion described above — they search the raw query. For plugin engines this means **short/terse queries rank better through agent recall (`dw-recall`) than through the web UI**. Normal, descriptive queries are unaffected. Full UI parity is tracked as future work (it needs a query-expansion step on the server side).

## Memory-agnostic: swap backends without losing content

diffwiki is deliberately **memory-agnostic**. The memory / RAG backend — the thing that embeds and indexes your notes for semantic retrieval — is a *plugin*, not the source of truth. Your content is always plain markdown in git; the index is a derived, rebuildable artifact that lives beside it. That separation means you can swap backends on the fly and lose nothing.

Concretely: install a different engine, point the default at it, and reindex — your articles are untouched.

```bash
diffwiki plugin install some-other-memory-db
diffwiki config set defaultSearch some-other-memory-db:hybrid
diffwiki search index --embed        # rebuild the new backend's index from the same markdown
```

Because retrieval degrades to the always-available native BM25 engine, search keeps working even while a backend is being swapped or reindexed. You are never locked into one vector store, and switching memory systems is never a content migration — it is just rebuilding an index. (Mixing and matching multiple memory backends is on the [Roadmap](/whats-next#roadmap).)

## RAG: observable agent memory

The same search surface is what makes diffwiki useful as retrieval-augmented generation. When a coding agent uses your wiki as memory, retrieval is not a hidden vector lookup buried in a pipeline — it is the exact same user-facing search you run yourself.

That has a real benefit: a human can inspect and trust what agents retrieve. You can run the query the agent would run and see precisely which notes it would pull as context. Combined with the fact that the memory itself is [markdown in git](/user-guide/continuous-learning) — diffable, browsable, and reviewable — retrieval becomes observable end to end rather than a black box. See [Using with Coding Agents](/user-guide/coding-agents) for the write side of that loop.

## Where to go next

- [Using with Coding Agents](/user-guide/coding-agents) — how agents write to and read from the wiki.
- The [Plugin SDK](/api-docs/plugins) documents the wire protocol for authoring your own search engine.
- [diffwiki-core](/api-docs/core) exposes the search and ranking APIs, including the browser-side scorer.
