---
title: Continuous learning
tags:
  - user-guide
  - continuous-learning
  - contributing
  - self-improvement
order: 3
---

# Continuous learning

Contributing to a diffwiki is deliberately unremarkable: you write and edit markdown files. There is no publishing pipeline to feed, no import step, and no special tooling to learn. Create a `.md` or `.mdx` file in a [collection's](/user-guide/collections) directory and it is an article; edit that file and the article changes. Everything else in this guide — search, the knowledge graph, publishing — is built on top of those plain files.

## Adding and editing articles

Open the collection's directory in your editor and work with the files directly. A global collection lives under `~/.diffwiki/<name>`; a repo collection lives at the wiki path inside the repo (`wiki/` by default). To add an article, create a new markdown file; to revise one, edit it and save. Because the files are in git, committing your change is how you record it — the same commit-and-review workflow you already use for code.

The CLI's article commands (`add-article`, `update-article`, `add-tags`) exist for **coding agents and automation**, not for people. As a human contributor you do not need them — edit the markdown. See [Using with Coding Agents](/user-guide/coding-agents) for how agents write into a wiki programmatically.

## Frontmatter

An optional YAML frontmatter block at the top of a file gives an article structure and controls how it appears:

```markdown
---
title: Refresh token rotation
tags:
  - auth
  - security
order: 3
audience: private
status: draft
---

# Refresh token rotation

Tokens are rotated when...
```

- `title` — the display title shown in navigation and search. Without it, diffwiki derives a title from the filename.
- `tags` — a list that feeds both search ranking and the knowledge graph. Consistent tagging is what gives a collection real, retrievable structure.
- `order` — a number controlling position within the collection's navigation (lower first). Use it to turn a set of notes into a deliberate reading sequence.
- `audience: private` — marks the article as private. Private articles are excluded from published static sites and their search index, so you can keep working notes in a wiki you also publish.
- `status: draft` — marks the article as an unfinished draft. Drafts are likewise dropped from static builds and flagged in the local sidebar, so unfinished writing never leaks into a published site.

Both `audience` and `status` can also be set on a collection's `index.md` to keep an entire collection out of a published build until it is ready.

## The knowledge graph

diffwiki links your notes into a graph so the wiki is more than a flat pile of files. Two mechanisms feed it:

- **Wiki-links** between articles — cross-references from one note to another.
- **Shared tags** — articles that carry the same tag are related in the graph.

The local UI and the published site render this graph, so you can see how ideas connect and navigate by relationship rather than only by folder. Tagging well and linking related notes is the main way you make a collection navigable as it grows.

## Self-improvement

A diffwiki is meant to accrete. Every time you (or a coding agent working alongside you) learn something worth keeping, you capture it as a note, and the wiki gets a little more complete. Because the whole store is markdown in git:

- **Knowledge accretes transparently.** Each addition or correction is a commit. You can see exactly what was learned, when, and by whom.
- **It stays reviewable.** Changes go through the same diff-and-review flow as code, so a wrong or stale note can be caught, corrected, or reverted like any other change.
- **Nothing is a black box.** The memory of the project is readable text, not an opaque store — you can always read what the wiki "knows."

This is where coding agents become powerful: they can capture what they discover during a task straight into the wiki, and because those writes are ordinary commits to ordinary markdown, you review and trust them exactly as you would a teammate's notes. See [Using with Coding Agents](/user-guide/coding-agents) for how that loop works.

## Where to go next

- [Using with Coding Agents](/user-guide/coding-agents) — how agents contribute to and read from your wiki.
- [Search & RAG](/user-guide/search-and-rag) — how the notes and tags you write become retrievable.
- [Sharing & Publishing](/user-guide/sharing) — turning your collection into a shareable site.
