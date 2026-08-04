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

diffwiki is designed to be an agent's long-term memory that a human can actually see. As coding agents work, they capture what they learn into your wiki as markdown; those notes are git-tracked, [searchable](/user-guide/search-and-rag), and [publishable](/user-guide/sharing) — so the memory store is observable, not a black-box vector database. This page covers the agent-facing surface: the CLI commands agents use to write, how they read the wiki back through search, and the `dw-*` agent skills.

While people [contribute by editing markdown directly](/user-guide/continuous-learning), agents need a programmatic way to write. That is what the article CLI commands are for — they are aimed at agents and automation, not at people.

## How agents write to the wiki

Agents append findings as articles, revise them as understanding improves, and tag them so they are retrievable later:

```bash
diffwiki article create "memory:auth-flow" -b "# Auth flow\n\nTokens are minted in..." -t "auth,findings"
diffwiki article update "memory:auth-flow" -b "# Auth flow\n\nCorrected: refresh happens in..."
diffwiki article update "memory:auth-flow" --status draft   # mark work-in-progress
diffwiki tags add "memory:auth-flow" "verified,security"
```

- `article create "<[collection:]title>"` creates an article. `-b/--body` sets the markdown body (optional); `-t, --tag` is repeatable; `--audience <public|private>` and `--status <draft|published>` set frontmatter (defaults `public`/`published`).
- `article update "<collection:slug>"` updates any of body (`-b`), tags (`-t`, replaces the set), audience, or status — pass at least one.
- `tags add "<collection:slug>"` adds a comma-separated tag list (with sibling commands `tags remove` and `tags set`).

Because these writes land as plain markdown files in a [collection](/user-guide/collections) — a global collection for cross-project memory, or a repo collection when the memory should travel with the code — every agent write is an ordinary git commit you can review, diff, and revert like a teammate's contribution.

## How agents read the wiki

Agents retrieve context the same way you search: through `diffwiki search query`. There is no separate agent-only retrieval path.

```bash
diffwiki search query -c memory "how are refresh tokens rotated"
```

Keyword retrieval uses `diffwiki-ripgrep` or native BM25; semantic and hybrid retrieval use `diffwiki-qmd`. Because retrieval is user-facing [search](/user-guide/search-and-rag), you can run the exact query an agent would and see precisely what context it pulls — which is what makes diffwiki's agent memory trustworthy rather than opaque.

## The `dw-*` agent skills

diffwiki ships a set of agent skills for the full authoring and learning loop. Install them via the agentskills CLI:

- **/dw-remember** — route to the best-fit collection, pick a template shape, and write or update one entry as a draft. Accepts `--research` to gather verified references first.
- **/dw-recall** — pull the most relevant entries into context as compact snippets, honoring `context.collections`. Agents call this to ground their work before writing.
- **/dw-learn** — learn from a source and mine it into drafts. Three modes: `session` (this conversation), `history` (past project sessions), or `repo` (a local or external codebase). Session and history capture into a hidden transcripts store before mining.
- **/dw-lint** — check entries against the template rules and offer to tighten failures via the `dw-reviewer` agent.
- **/dw-dream** — a periodic pass that improves, dedupes, and prunes the wiki safely.

See [Agent Skills](/user-guide/agent-skills) for the full skill list and the template shapes they use.

## Observable memory by construction

Nothing here requires a special observability mode. It falls out of the design: memory is files, writes are commits, and retrieval is the same search a user runs. That is the loop the [vision](/whats-next#vision) calls for — git-tracked, RAG-backed agent memory that a person can search, read, and trust.

## Where to go next

- [Search & RAG](/user-guide/search-and-rag) — the retrieval surface in depth, including plugins and fallback.
- [Continuous learning](/user-guide/continuous-learning) — the human side of the same wiki.
- [Vision](/whats-next#vision) and the [Roadmap](/whats-next#roadmap) — where observable agent memory is heading.
