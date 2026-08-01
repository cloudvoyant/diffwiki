# diffwiki

diffwiki is a git-based personal knowledge base: manage topic-specific markdown wikis
("collections") from your terminal — globally or attached to any repository — with real
full-text search and a local web UI.

> **Live showcase:** https://cloudvoyant.github.io/diffwiki/ — a diffwiki that documents itself, built from `wiki/` and deployed by diffwiki's own static exporter.

## Features

- **Git-based collections** — markdown/mdx notes organized into named collections under
  `~/.diffwiki`, tracked in a single registry so the CLI can find them all.
- **In-repo wikis** — `diffwiki collection init` attaches a wiki to any repository so its notes travel
  with the code, while still appearing alongside your global collections.
- **External collections** — `diffwiki collection add` registers the current git repo (its `docs/` dir)
  as a collection with no config file; unique by git repo id, worktree-aware.
- **Plugin-based search** — a built-in zero-dependency BM25 engine, plus optional subprocess
  search plugins: `diffwiki-ripgrep` (fast keyword) and `diffwiki-qmd` (semantic/hybrid). Pick
  a default with `config set defaultSearch`; `search query` falls back to native automatically.
- **Static export** — `diffwiki site export -o ./dist` builds a fully static site (HTML + assets +
  client-side search) deployable to GitHub Pages or any file host.
- **Local web UI** — a TanStack Start app (`apps/wiki`) for browsing collections, reading
  rendered articles, and searching, launched with `diffwiki ui up`/`open`.
- **Agent skills** — `/dw-remember`, `/dw-recall`, `/dw-lint`, `/dw-learn`, `/dw-dream` plus a `diffwiki lint` command and a hidden `transcripts` collection. Install via agentskills; see [docs/agent-skills.md](docs/agent-skills.md).

## Requirements

- Node.js (LTS)
- [mise](https://mise.jdx.dev/getting-started.html)

Run `mise install` to install all tools, then `mise run install` for any additional dependencies.

## Quick Start

```bash
git clone <your-repo>
cd diffwiki
mise install
```

Type `mise tasks` to see all available tasks:

```bash
❯ mise tasks
build        Build the project
clean        Clean build artifacts
install      Install dependencies
publish      Publish package to registry
run          Run project locally
test         Run tests
...
```

Build, run, and test with `mise run`:

```bash
mise run run
mise run test
```

Task dependencies run automatically — `mise run test` runs `build` first!

Commit using conventional commits (`feat:`, `fix:`, `docs:`). Merge/push to main and CI/CD will run automatically bumping your project version and publishing a package.

## Documentation

- [User Guide](docs/user-guide.md) - Complete setup and usage guide
- [Architecture](docs/architecture.md) - Design and implementation details
- [Infrastructure](docs/infrastructure.md) - Infrastructure and CI/CD details
- Published site source lives in `wiki/`; see [User Guide → Publishing](docs/user-guide.md#publishing) to build and deploy it.

## References

- [mise - dev tool manager](https://mise.jdx.dev/)
- [semantic-release](https://semantic-release.gitbook.io/)
- [bats-core bash testing](https://bats-core.readthedocs.io/)
- [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [GCP Artifact Registry](https://cloud.google.com/artifact-registry/docs)

---

**Template**: mise-lib-template v2.15.0
