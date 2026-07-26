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

- **`diffwiki-ripgrep`** — instant literal and regex keyword search via the `rg` binary. It needs no index and no models; its only setup is verifying `rg` is on PATH. Types: `text` and `regex`.
- **`diffwiki-qmd`** — keyword, semantic, and hybrid search backed by the `qmd` CLI, with a resident embedding-model daemon for low-latency semantic queries. Types: `keyword`, `semantic`, and `hybrid`.

Install a plugin and make it the default engine:

```bash
diffwiki plugin install diffwiki-ripgrep
diffwiki plugin install diffwiki-qmd
diffwiki config-set defaultSearch diffwiki-qmd:hybrid
```

The value passed to `config-set defaultSearch` is `<engine>[:<type>]`, where the engine name is the plugin name — for example `diffwiki-qmd:hybrid` or `diffwiki-ripgrep:regex`. `plugin install` provisions the plugin end-to-end and, unless you pass `--no-default`, sets it as the default engine. List what is installed and available with `diffwiki plugin list`.

## Querying

```bash
diffwiki query "static export"                 # uses the resolved default engine
diffwiki query -c user-guide "search"          # limit to a single collection
diffwiki query --engine diffwiki-ripgrep -t regex "config-.*"   # pick engine + type
```

Each result line is `score  collection  title  path  [snippet]`. The score scale is engine-dependent, so use it to eyeball a cutoff within a single result set rather than to compare across engines.

## Engine routing and automatic fallback

`query` resolves an engine in strict precedence: an explicit `--engine`, then `config.defaultSearch`, then the first enabled search plugin, and finally the native BM25 engine. Crucially, if the chosen plugin fails or is unavailable, diffwiki captures the error and falls back to native BM25 automatically, so a search always returns results. When that happens the CLI prints a warning naming the engine that failed, so you always know whether results came from the intended engine or from the native fallback.

## Indexing

Plugins that maintain an index expose `diffwiki index`:

```bash
diffwiki index            # rebuild the active plugin's index
diffwiki index --embed    # also build vector embeddings (may download models)
```

The native engine has no index to build — it reads collections live — so `diffwiki index` reports nothing to index when native search is active. Run `diffwiki doctor` to check plugin readiness (tool installed, models present, index built, embeddings pending).

## Search in the published site

When you [publish](/user-guide/sharing), diffwiki ships the BM25 index as a static asset. The site's `/search` page runs the same BM25 ranking client-side, with no server — the scorer runs in the browser over the shipped index. That makes the published wiki's search identical to the local experience, and it works on any static host.

## Memory-agnostic: swap backends without losing content

diffwiki is deliberately **memory-agnostic**. The memory / RAG backend — the thing that embeds and indexes your notes for semantic retrieval — is a *plugin*, not the source of truth. Your content is always plain markdown in git; the index is a derived, rebuildable artifact that lives beside it. That separation means you can swap backends on the fly and lose nothing.

Concretely: install a different engine, point the default at it, and reindex — your articles are untouched.

```bash
diffwiki plugin install some-other-memory-db
diffwiki config-set defaultSearch some-other-memory-db:hybrid
diffwiki index --embed        # rebuild the new backend's index from the same markdown
```

Because retrieval degrades to the always-available native BM25 engine, search keeps working even while a backend is being swapped or reindexed. You are never locked into one vector store, and switching memory systems is never a content migration — it is just rebuilding an index. (Mixing and matching multiple memory backends is on the [Roadmap](/whats-next#roadmap).)

## RAG: observable agent memory

The same search surface is what makes diffwiki useful as retrieval-augmented generation. When a coding agent uses your wiki as memory, retrieval is not a hidden vector lookup buried in a pipeline — it is the exact same user-facing search you run yourself.

That has a real benefit: a human can inspect and trust what agents retrieve. You can run the query the agent would run and see precisely which notes it would pull as context. Combined with the fact that the memory itself is [markdown in git](/user-guide/continuous-learning) — diffable, browsable, and reviewable — retrieval becomes observable end to end rather than a black box. See [Using with Coding Agents](/user-guide/coding-agents) for the write side of that loop.

## Where to go next

- [Using with Coding Agents](/user-guide/coding-agents) — how agents write to and read from the wiki.
- The [Plugin SDK](/api-docs/plugins) documents the wire protocol for authoring your own search engine.
- [diffwiki-core](/api-docs/core) exposes the search and ranking APIs, including the browser-side scorer.
