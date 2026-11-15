---
title: Agent Skills
tags: [user-guide, agent-skills, claude-code]
---

diffwiki ships agent skills that let you and your agents author, forget, recall, sync, lint, learn, and maintain the wiki. Install them via the agentskills CLI. If you install skills before diffwiki, run `/dw-install` to bootstrap the CLI and seed your templates.

## The skills

- `/dw-init`: set up an in-repo or global collection and configure `context.collections` for recall.
- `/dw-remember`: capture one piece of knowledge as a templated draft routed to the best-fit collection by subject (including nested subpaths such as `react/tanstack` or `python/pydantic`).
- `/dw-forget`: remove articles from the default or named collection after confirming matches, or remove collections via `diffwiki collection remove` (asking before `--force` on non-empty global collections).
- `/dw-recall`: pull relevant entries into context as compact snippets so agents can ground their work.
- `/dw-sync`: pull `origin/main` and push non-draft updates to `origin/user/<username>` on your linked GitHub repository, joining an open pull request across repeated syncs and merging only when requested.
- `/dw-lint`: check entries against template rules and offer to tighten failures.
- `/dw-learn`: capture verbatim harness sessions and `.difflab` review/plan feedback into `transcripts` metadata, propose learning candidates upfront, and draft approved entries (`--yes` or `--auto` skips confirmation) across `session`, `history`, and `repo` modes.
- `/dw-dream`: run a periodic improve, dedupe, and prune pass that leaves drafts and deprecations for review.
- `/dw-help`: explain the diffwiki CLI commands and installed `dw-*` skills.

## System content

diffwiki stores internal working data (such as captured session summaries in `transcripts`) in `system`-audience collections hidden by default from search, recall, and navigation. Verbatim harness logs and `.difflab` records live in `~/.diffwiki/meta/transcripts/`. Run `diffwiki config set showSystem true` to reveal system collections in the UI.

## Template shapes

Each entry conforms to one of five shapes discovered via `diffwiki templates list`:

| Shape | Use when |
|---|---|
| `guide` | Explaining the reasoning behind a topic and connecting related patterns |
| `recipe` | Documenting one contained pattern with a single canonical example |
| `recipe-with-steps` | Giving an ordered sequence: install X, configure Y, run Z |
| `reference` | Listing CLI flags, configuration keys, environment variables, or API endpoints |
| `collection-index` | Grouping a collection's articles by topic with one-line descriptions and links |

Shapes carry authoring rules in each template file. Add custom shapes by placing a `*-template.md` file with `shape:`, `purpose:`, and `budget:` frontmatter into `~/.diffwiki/templates/`.

## Writing standards

Every skill vendors `references/technical-writing-guide.md`: use `/simple-english`, keep artifacts terse, avoid walls of text and inline file/class inventories, prefer Mermaid or draw.io diagrams, and take a second pass to shorten and simplify further.
