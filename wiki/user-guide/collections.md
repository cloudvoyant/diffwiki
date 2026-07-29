---
title: Collections
tags:
  - user-guide
  - collections
order: 1
---

# Collections

A collection is a directory of markdown (`.md` / `.mdx`) notes that diffwiki tracks in a single global registry, so the CLI can find and search every wiki you own no matter where it lives on disk. Collections are the unit of organization, search, and publishing. There are three kinds, but in practice they serve two everyday usage patterns.

## Two ways people use diffwiki

**A personal or team knowledge base.** Your durable, cross-project notes live in a global collection under `~/.diffwiki`. This is the knowledge that outlives any single repo — research, runbooks, decisions, things you learned once and never want to relearn. It stays put on your machine (or a repo you sync), and it is always available regardless of which project you happen to be in.

**Project-specific wikis.** Documentation that belongs to a codebase lives inside that codebase's repository. When you check out a project that has a diffwiki, its wiki comes with the code and is instantly discoverable alongside your global notes via `diffwiki collection list`. You get one unified view — your personal knowledge base plus the wikis of every project you are working on — without any of them being tangled together.

Both patterns use the same tools and the same search; the only difference is where the markdown files physically live.

## The three collection types

### Global collections — your knowledge base

Created with `diffwiki collection create <name>` and stored under `~/.diffwiki`. Global collections are for knowledge that is not tied to any single repository. This is the home for a personal or shared team knowledge base.

```bash
diffwiki collection create notes
```

This creates `~/.diffwiki/notes` and registers it globally. From then on you contribute to it by editing the markdown files inside `~/.diffwiki/notes`.

### Repo collections — wikis that travel with the code

Created with `diffwiki collection init` inside a git repository. `collection init` writes a `diffwiki.yaml` to the repo and places the wiki at `wiki/` by default, so the notes are committed alongside the code and travel with the repository when it is cloned, forked, or moved. This is the right choice for documentation that should version in lockstep with a codebase.

```bash
diffwiki collection init -c my-repo -p wiki
```

- `-c, --collection` sets the collection name (defaults to the repo name).
- `-p, --path` sets the wiki path within the repo (defaults to `wiki`).

The collection is also registered globally, so anyone who checks out the repo and runs `diffwiki collection list` sees it next to their own global collections even though it physically lives inside the project. See [Sharing & Publishing](/user-guide/sharing) for how the extended `diffwiki.yaml` declares several such collections for a published site.

### External collections — docs directories, unmodified

Registered with `diffwiki collection add`, which points at an existing repository's documentation directory (`docs/` by default) without writing any config file. External collections are ideal for surfacing docs from repos you do not want to modify — you register the current git repo and diffwiki reads its docs in place.

```bash
diffwiki collection add            # registers ./docs of the current repo
diffwiki collection add -d documentation   # use a different content dir
```

External collections are keyed by git repo id and are worktree-aware, so registering the same repo twice does not create duplicates, and different worktrees of the same repo resolve correctly.

## Listing collections

```bash
diffwiki collection list
```

Each row shows the collection name, its type (`global`, `repo`, or `external`), its absolute path, and — when the directory is a git working tree — the current branch. This single list is the unified view of your knowledge base plus every project wiki you have checked out. If you have no collections yet, the CLI prompts you to create one.

## Display titles and ordering

diffwiki separates the URL of a collection from its human-facing label, and lets you control the order things appear in navigation.

- **Display title.** A collection's title in the site navigation comes from its `index.md` frontmatter `title:`, while its URL uses the slug name. That is how a collection at `/user-guide` can show the label "User Guide" in the nav.
- **Article order.** Within a collection, articles are ordered by an `order:` number in each article's frontmatter (lower first), so you can present a guide as a deliberate reading sequence rather than an alphabetical list. Articles without `order` fall back to a stable default ordering.
- **Collection order.** When you publish several collections, the `order` field on each collection entry in `diffwiki.yaml` controls the order of the top-level sections — see [Sharing & Publishing](/user-guide/sharing).

## Where to go next

- [Continuous learning](/user-guide/continuous-learning) — how to add and edit articles, and the frontmatter that gives a collection structure.
- [Search & RAG](/user-guide/search-and-rag) — search across every registered collection at once.
- The [CLI Reference](/api-docs/cli) lists every command and flag; [diffwiki-core](/api-docs/core) documents the underlying collection API.
