---
title: Getting Started
tags: [getting-started, overview]
---

# Getting Started

diffwiki is a git-based knowledge base you run from your terminal: notes live as plain markdown in named collections, tracked in git, with real full-text search, a local web UI, and one-command export to a static site. This page walks the whole path — install, write, use it with your coding agents, share — in order. Follow it top to bottom.

## Install

All you need is a recent [Node.js](https://nodejs.org) LTS. There are two ways to run diffwiki.

Run it on demand with **`npx`** — no install:

```bash
npx diffwiki <command>
```

Or install it **globally** so the `diffwiki` binary is on your PATH:

```bash
npm install -g diffwiki
diffwiki <command>
```

The commands throughout these docs are written as bare `diffwiki <command>`, which assumes a global install; if you skip it, just prefix them with `npx`. (Building from source is only for contributing to diffwiki itself.)

To see the web UI, start it, open it, and stop it when you're done:

```bash
npx diffwiki ui up      # start the local UI
npx diffwiki ui open    # open it in your browser (starts it if needed)
npx diffwiki ui down    # stop it
```

## Write

This is the heart of diffwiki: **you write and edit plain markdown files directly.** You do not use CLI commands to add articles by hand — the `article create` / `article update` commands exist for coding agents (see [Coding Agents](/user-guide/coding-agents)). For a human, the flow is: create a wiki, then open your editor and write `.md`/`.mdx` files.

For a wiki that travels with a repo, attach one to the current repo — this writes a `diffwiki.yaml` and a wiki directory into the repo:

```bash
diffwiki collection init
```

For a personal knowledge base independent of any repo, create a global collection under `~/.diffwiki`:

```bash
diffwiki collection create <name>
```

Now write. `diffwiki collection edit` opens the wiki in your editor — no GUI required — so you can create and edit `.md`/`.mdx` files directly; that is all "adding an article" means. It uses `$EDITOR` (or set one with `diffwiki config set editor "<cmd>"`, or pass `--editor`):

```bash
diffwiki collection edit                 # open the current repo's wiki in your editor
diffwiki collection edit <name>          # open a specific collection
```

Prefer to browse as you go? `diffwiki ui open` shows your notes live in the web UI. To render the repo's `diffwiki.yaml` project specifically (ignoring your global collections), use `diffwiki site preview` instead.

As a rule of thumb, a personal knowledge base lives under `~/.diffwiki` (global collections) while project-specific wikis live inside the repo they document (repo collections). See [Collections](/user-guide/collections) for the full taxonomy.

## Use it with your coding agents

🚧 **Coming soon.**

diffwiki is designed to be observable, git-tracked memory for your coding agents — they read from and write to the same wiki you do, so what an agent "knows" is a diffable, browsable, searchable set of markdown files rather than an opaque vector store.

The planned interface is a `/dw` agent skill with three workflows:

- **`/dw query`** — fast lookup for a specific fact or article.
- **`/dw search`** — deep semantic/hybrid search across collections.
- **`/dw learn`** — session- or user-specific consolidation, where the agent writes what it learned back into the wiki as memory.

See [Coding Agents](/user-guide/coding-agents) for how this fits together.

## Share

When you want to publish, export your wiki as a self-contained static site and deploy it anywhere — GitHub Pages, for example:

```bash
diffwiki site export --project -o dist-site -b /repo/
```

The showcase site you are reading is built the exact same way. Point GitHub Pages at the exported directory, or just share the git repo directly and let others run it locally. See [Sharing](/user-guide/sharing) for deployment details.

## Where next

- [User Guide](/user-guide) — collections, search, and everyday workflows.
- [API Docs](/api-docs) — the [CLI](/api-docs/cli), [core](/api-docs/core), and [plugins](/api-docs/plugins).
- [What's Next](/whats-next) — the [vision](/whats-next#vision), [roadmap](/whats-next#roadmap), and where to leave [feedback](/whats-next#feedback).
