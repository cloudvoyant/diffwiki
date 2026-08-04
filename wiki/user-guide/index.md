---
title: User Guide
tags:
  - user-guide
  - overview
---

# User Guide

diffwiki is a git-based knowledge base you own. Your notes are plain markdown files in git — you write and edit them the way you write any documentation, and diffwiki turns that directory into a searchable, browsable, publishable wiki. This guide is for the people who use and contribute to a diffwiki: capturing what you learn, letting the wiki grow over time, searching it, and sharing it.

If you have not set up diffwiki yet, start with [Getting Started](/getting-started); it walks you through running the CLI with `npx` (no install), creating your first wiki, editing it in your editor, and publishing it. This guide picks up from there and goes deeper.

## The core idea

You write plain markdown. That is the whole contract. Create or edit a `.md` file in a wiki directory, add a little frontmatter if you like, and it becomes an article — no special commands, no database, no import step. Because every note is a file tracked in git, your knowledge base is diffable, reviewable, and portable, and it can travel with your code or live on its own.

The CLI is there to organize, search, publish, and (for coding agents) write into your wiki — but the source of truth is always the markdown files you edit directly.

## In this guide

- [Collections](/user-guide/collections) — the three kinds of wiki (your personal/team knowledge base under `~/.diffwiki`, project wikis that travel inside a repo, and external docs directories), all discoverable from one registry.
- [Theming](/user-guide/theming) — reading is personal: pick a theme and light/dark mode like you would in your editor.
- [Continuous learning](/user-guide/continuous-learning) — how you contribute by editing markdown, the frontmatter and knowledge graph that give a wiki structure, and how it self-improves as you and your agents capture what you learn.
- [Search & RAG](/user-guide/search-and-rag) — the native BM25 engine, optional keyword and semantic plugins, client-side search in the published site, and why the same search surface makes agent retrieval observable.
- [Using with Coding Agents](/user-guide/coding-agents) — how agents write into your wiki and read it back through search, and the `dw-*` agent skills for authoring, recall, and learning.
- [Sharing & Publishing](/user-guide/sharing) — the `diffwiki.yaml` project config, local preview, and shipping a static site to GitHub Pages.

## Where to go next

- The [API Docs](/api-docs) cover the [CLI](/api-docs/cli), [diffwiki-core](/api-docs/core), and the [plugin SDK](/api-docs/plugins).
- [What's Next?](/whats-next) lays out the [vision](/whats-next#vision), the [roadmap](/whats-next#roadmap), and where to leave [feedback](/whats-next#feedback).
