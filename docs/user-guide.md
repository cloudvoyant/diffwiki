# diffwiki CLI — User Guide

> A git-based personal knowledge base: manage topic-specific wikis ("collections") from your
> terminal, globally or attached to any repo.

## Introduction

diffwiki lets you capture and organize markdown notes into named collections. Global
collections live under `~/.diffwiki/collections`; you can also `init` a wiki inside any
repository so its notes travel with the code. A single `registry.json` tracks every
collection so `diffwiki list` can find them all. This guide covers the CLI shipped by this
scaffold. Search (`query`) is a placeholder for now — real semantic (QMD) search and any UI
come later.

## Requirements

- Node.js (LTS) and pnpm 10 (managed by `mise`).
- Build once with `mise run build` before invoking the real binary, or run commands through
  the workspace during development.

## Quick Start

```bash
# 1. Pick a default collection so you can omit the name later
diffwiki create notes
diffwiki config-set defaultCollection notes

# 2. Add an article (returns the file path it wrote)
diffwiki add -p "notes:Setting up mise" -t tooling,setup "# Setting up mise

Install mise, then run \`mise install\`."
# → ~/.diffwiki/collections/notes/setting-up-mise.md

# 3. See what you have
diffwiki list
diffwiki query mise
```

## Primary Use Case — capturing a note

`diffwiki add` is the fast path. `-p` takes `[collection:]title`; if you omit `collection:`
it uses `config.defaultCollection`. `-t` may be repeated and accepts comma-separated tags.
The trailing argument is the optional markdown body.

```bash
diffwiki add -p "Rebasing safely" -t git,notes "# Rebasing safely

Always \`git pull --rebase\` before pushing to avoid clobbering remote commits."
```

## In-repo wikis

```bash
cd my-project
diffwiki init                 # writes diffwiki.yaml, registers the repo wiki globally
diffwiki init -c my-wiki -p docs/wiki   # explicit collection name + path within the repo
diffwiki list                 # the repo wiki now appears alongside global ones
```

`init` defaults the collection name to the repo name and the path to `wiki/`. If the derived
name already belongs to a different collection, it is disambiguated (`name-2`, `name-3`, …).

## Command Reference

### `diffwiki list`

Lists every registered collection (global and repo) with its type and path.

### `diffwiki create <name>`

Creates a global collection directory and registers it. **Errors** if the name is taken.

### `diffwiki add -p "[coll:]title" [-t tags]… [body]`

Creates an article. `-p` → `[collection:]title` (collection optional → default). `-t` →
repeatable, comma-split tags. `body` → optional markdown (defaults to `# <title>`).
**Returns** the article path on stdout.

### `diffwiki update -p "coll:path" <body>`

Replaces an article's body, preserving its title and tags.

> **Path form:** `-p "coll:path"` resolves the `path` segment the same way `add` writes it
> — it is slugified. So you can pass either the slug (`notes:my-title`) or the original
> title (`notes:My Title`); both resolve to `my-title.md`. Pass an explicit `.md`/`.mdx`
> filename to bypass slugifying.

### `diffwiki add-tags | remove-tags | update-tags -p "coll:path" <comma,separated,tags>`

Adds, removes, or replaces (`update-tags`) an article's tags.

### `diffwiki remove -p "coll:path"`

Deletes an article file.

### `diffwiki query [-c collection] [term]`

**Dummy** case-insensitive substring search over title, filename, and tags. Prints matches;
a stand-in for future QMD search.

### `diffwiki init [-c collection] [-p path]`

Creates an in-repo wiki, writes `diffwiki.yaml`, and registers it globally.

### `diffwiki config-set <key> <value>` / `diffwiki config-get <key>`

Reads/writes `~/.diffwiki/config.json` (e.g. `defaultCollection`).

### `diffwiki doctor`

Diagnoses configuration: home/registry presence, collection paths, and default-collection
validity. Exits non-zero if any error-level issue is found.

## Configuration

- **`DIFFWIKI_HOME`** — overrides `~/.diffwiki` (used by tests to sandbox state).
- **`~/.diffwiki/registry.json`** — `{ version, collections: [{ name, type, path, createdAt
}] }`.
- **`~/.diffwiki/config.json`** — `{ defaultCollection?: string }`.
- **`diffwiki.yaml`** (in-repo) — `{ collection, path }`.

## Future Work / Troubleshooting

### Known Limitations

- `query` is a placeholder (no semantic/QMD search).
- No MDX compilation; `.mdx` is stored but not validated.
- Publishing/CI wiring for the new packages is a follow-up (see plan Future Work).

### Common Issues

#### "No default collection set"

Run `diffwiki config-set defaultCollection <name>` (the collection must exist), or pass
`collection:` explicitly in `-p`.

#### State ended up somewhere unexpected

Check `DIFFWIKI_HOME` — if set, diffwiki uses it instead of `~/.diffwiki`. Run `diffwiki
doctor` to see resolved paths.

## References

- [Commander.js](https://www.npmjs.com/package/commander)
