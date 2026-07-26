---
title: Using with Coding Agents
tags:
  - user-guide
  - agents
  - rag
  - self-improvement
order: 5
---

# Using with Coding Agents

diffwiki is designed to be an agent's long-term memory that a human can actually see. As coding agents work, they capture what they learn into your wiki as markdown; those notes are git-tracked, [searchable](/user-guide/search-and-rag), and [publishable](/user-guide/sharing) — so the memory store is observable, not a black-box vector database. This page covers the agent-facing surface: the CLI commands agents use to write, how they read the wiki back through search, and the planned `/dw` skill.

While people [contribute by editing markdown directly](/user-guide/continuous-learning), agents need a programmatic way to write. That is what the article CLI commands are for — they are aimed at agents and automation, not at people.

## How agents write to the wiki

Agents append findings as articles, revise them as understanding improves, and tag them so they are retrievable later:

```bash
diffwiki add-article -p "memory:auth-flow" -t "auth,findings" "# Auth flow\n\nTokens are minted in..."
diffwiki update-article -p "memory:auth-flow" "# Auth flow\n\nCorrected: refresh happens in..."
diffwiki add-tags -p "memory:auth-flow" "verified,security"
```

- `add-article -p "[collection:]title"` creates an article, with an optional markdown body and an optional repeatable `-t, --tag`.
- `update-article -p "collection:path"` replaces an article's body.
- `add-tags -p "collection:path"` adds a comma-separated tag list (with sibling commands `remove-tags` and `update-tags`).

Because these writes land as plain markdown files in a [collection](/user-guide/collections) — a global collection for cross-project memory, or a repo collection when the memory should travel with the code — every agent write is an ordinary git commit you can review, diff, and revert like a teammate's contribution.

## How agents read the wiki

Agents retrieve context the same way you search: through `diffwiki query`. There is no separate agent-only retrieval path.

```bash
diffwiki query -c memory "how are refresh tokens rotated"
```

Keyword retrieval uses `diffwiki-ripgrep` or native BM25; semantic and hybrid retrieval use `diffwiki-qmd`. Because retrieval is user-facing [search](/user-guide/search-and-rag), you can run the exact query an agent would and see precisely what context it pulls — which is what makes diffwiki's agent memory trustworthy rather than opaque.

## The `/dw` skill (coming soon)

🚧 A dedicated `/dw` skill for coding agents is planned to make this loop first-class inside an agent session:

- `/dw query` — a fast lookup for quick, in-the-loop retrieval.
- `/dw search` — a deeper, more thorough search when a quick lookup is not enough.
- `/dw learn` — consolidates what was learned in a session (or across a user's sessions) and writes those learnings back into the wiki as durable memory, closing the self-improvement loop described in [Continuous learning](/user-guide/continuous-learning).

Until it ships, agents use the CLI commands above directly.

## Observable memory by construction

Nothing here requires a special observability mode. It falls out of the design: memory is files, writes are commits, and retrieval is the same search a user runs. That is the loop the [vision](/whats-next#vision) calls for — git-tracked, RAG-backed agent memory that a person can search, read, and trust.

## Where to go next

- [Search & RAG](/user-guide/search-and-rag) — the retrieval surface in depth, including plugins and fallback.
- [Continuous learning](/user-guide/continuous-learning) — the human side of the same wiki.
- [Vision](/whats-next#vision) and the [Roadmap](/whats-next#roadmap) — where observable agent memory is heading.
