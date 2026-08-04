---
title: Agent Skills
tags: [user-guide, agent-skills, claude-code]
---

diffwiki ships agent skills that let you and your agents author, recall, lint, learn, and maintain the wiki. Install them via the agentskills CLI; if you install them before diffwiki, `/dw-install` bootstraps the CLI and seeds your templates.

## The skills

- **/dw-init** — guided setup: an in-repo or global collection plus the `context.collections` set recall searches.
- **/dw-remember** — capture one piece of knowledge as a tight, correctly-templated **draft**, routed to the best-fit collection by subject, with optional researched references.
- **/dw-recall** — pull the most relevant entries into context as compact snippets; agents call it to ground their work.
- **/dw-lint** — check entries against the template rules and offer to tighten failures.
- **/dw-learn** — learn knowledge from a source and mine it into drafts. Pick a mode: `session` (this conversation, the default), `history` (your past sessions in this project), or `repo` (a local or external codebase). Session and history capture into a hidden transcripts store first; repo reads the codebase directly.
- **/dw-dream** — a periodic pass that improves, dedupes, and prunes the wiki safely, leaving drafts and deprecations for review.
- **/dw-help** — explain the diffwiki CLI commands and all available dw-* skills; useful for new users or when you've forgotten what's available.

## System content

diffwiki keeps its own working data — like captured session transcripts — in `system`-audience collections that are hidden by default from search, recall, and the sidebar. Flip `diffwiki config set showSystem true` to reveal them in the UI.

## Template shapes

Each entry conforms to one of five shapes, discovered via `diffwiki templates list`:

| Shape | Use when |
|---|---|
| `guide` | Explaining the reasoning behind a topic — the "why" behind several related patterns |
| `recipe` | One contained pattern with a single canonical example |
| `recipe-with-steps` | An ordered sequence: install X, configure Y, run Z |
| `reference` | Lookup table: CLI flags, config keys, env vars, API endpoints |
| `collection-index` | A collection's root index — groups articles by topic with one-line descriptions and links |

Shapes carry their own authoring rules in the template file. Add your own by dropping a `*-template.md` with `shape:`/`purpose:`/`budget:` frontmatter into `~/.diffwiki/templates/`.

## Why brevity

diffwiki entries exist to drop cleanly into an LLM's context window. The skills and agents write tight, well-referenced snippets — verbosity works against the whole point.
