---
title: Agent Skills
tags: [user-guide, agent-skills, claude-code]
---

diffwiki ships agent skills that let you and your agents author, recall, lint, learn, and maintain the wiki. Install them via the agentskills CLI; if you install them before diffwiki, `/dw-install` bootstraps the CLI and seeds your templates.

## The skills

- **/dw-init** — guided setup: an in-repo or global collection plus the `context.collections` set recall searches.
- **/dw-remember** — capture one piece of knowledge as a tight, correctly-templated **draft**, routed to the project wiki or the knowledge base, with optional researched references.
- **/dw-recall** — pull the most relevant entries into context as compact snippets; agents call it to ground their work.
- **/dw-lint** — check entries against the template rules and offer to tighten failures.
- **/dw-learn** — capture your project's agent sessions into a hidden transcripts store, then mine them into drafts.
- **/dw-dream** — a periodic pass that improves, dedupes, and prunes the wiki safely, leaving drafts and deprecations for review.

## System content

diffwiki keeps its own working data — like captured session transcripts — in `system`-audience collections that are hidden by default from search, recall, and the sidebar. Flip `diffwiki config set showSystem true` to reveal them in the UI.

## Why brevity

diffwiki entries exist to drop cleanly into an LLM's context window. The skills and agents write tight, well-referenced snippets — verbosity works against the whole point.
