---
title: Agent Skills
tags: [user-guide, agent-skills, claude-code]
---

diffwiki ships agent skills that let you and your agents author, forget, recall, lint, learn, and maintain the wiki. Install them via the agentskills CLI; if you install them before diffwiki, `/dw-install` bootstraps the CLI and seeds your templates.

## The skills

- **/dw-init** — guided setup: an in-repo or global collection plus the `context.collections` set recall searches.
- **/dw-remember** — capture one piece of knowledge as a tight, templated **draft**, routed to the best-fit collection by subject (encouraging nested subpaths like `react/tanstack` or `python/pydantic`) and showing the target collection path.
- **/dw-forget** — remove one or more articles from the default collection or a specific collection after confirming matches.
- **/dw-recall** — pull the most relevant entries into context as compact snippets; agents call it to ground their work.
- **/dw-lint** — check entries against the template rules and offer to tighten failures.
- **/dw-learn** — capture verbatim harness sessions, session artifacts, and `.difflab` review/plan feedback into `transcripts` metadata, propose learning candidates upfront (showing title, nested target collection, shape, and `CREATE`/`UPDATE` action), and draft approved candidates (`--yes` / `--auto` to auto-draft). Modes: `session` (default, focused on general reusable learnings), `history` (past project sessions), or `repo` (a local or external codebase).
- **/dw-dream** — a periodic pass that improves, dedupes, and prunes the wiki safely, leaving drafts and deprecations for review.
- **/dw-help** — explain the diffwiki CLI commands and all available `dw-*` skills.

## System content

diffwiki keeps its own working data — such as captured session summaries in `transcripts` — in `system`-audience collections that are hidden by default from search, recall, and the sidebar. Verbatim harness logs and `.difflab` review/plan records live alongside in `~/.diffwiki/meta/transcripts/`. Run `diffwiki config set showSystem true` to reveal system collections in the UI.

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

## Writing standards

Every skill vendors `references/technical-writing-guide.md`: use `/simple-english`, keep artifacts terse, avoid walls of text and inline file/class inventories, prefer Mermaid/draw.io diagrams, and always take a second pass to shorten and simplify further.
