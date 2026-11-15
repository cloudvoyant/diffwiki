# Agent skills

Agent skills sit on top of the diffwiki CLI. The CLI writes articles, manages collections, syncs global wiki branches, and allocates source records. Skills fill source-record Markdown directly so original quotations, raw harness sessions, and human review feedback stay intact.

diffwiki ships `dw-*` skills for authoring, forgetting, recalling, syncing, linting, learning, and maintaining the wiki. Install them via the agentskills CLI. If you install skills before diffwiki, run `/dw-install` to bootstrap the CLI.

## CLI surface for skills

| Command | Purpose |
|---|---|
| `diffwiki lint [-c current\|all\|<names>]` | Lint entries against template shapes (frontmatter, token budgets, references, drafts, tag leaks). Exits 1 on error and skips system collections. |
| `diffwiki search query -c a,b,c` | Search a comma-separated set of collections. |
| `diffwiki collection create <name> --hidden` | Create a hidden system-audience collection (such as `transcripts`). |
| `diffwiki collection remove <name> [-f]` | Remove an empty global collection (or pass `--force` if articles remain), or unregister a repo/external collection. |
| `diffwiki link <repo> [--json]` | Link `~/.diffwiki` to a GitHub repository (`<owner>/<repo>` or URL) on branch `user/<username>`. |
| `diffwiki pull [--prefer <side>] [--json]` | Fetch `origin/main` and rebase `user/<username>` onto it (`--prefer remote` by default). |
| `diffwiki push [--include-drafts] [--merge] [--json]` | Commit non-draft changes, push `origin/user/<username>`, and join or open one pull request per user branch. |
| `diffwiki article create "<[collection[/subpath]:]title>" …` | Create an article (supports nested collection subpaths with a clean leaf title). |
| `diffwiki article remove "<[collection[/subpath]:]slug>"` | Remove an article from a named collection or `defaultCollection`. |
| `diffwiki config set showSystem true` | Reveal system-audience content in search, navigation, and the UI. |

`diffwiki.yaml` supports a recall context:
```yaml
context:
  collections: [my-repo, react, python]
```

## The `system` audience & transcripts

`system` is a third audience (alongside `public` and `private`) for diffwiki-internal content. System collections and articles stay hidden by default from `dw-recall`, search, lint, and the site until `showSystem` is enabled. `dw-learn` captures structured session summaries in the hidden `transcripts` collection (`transcripts:<project>/<date>-<id>`, `--audience system`) and stores verbatim raw harness sessions, session artifacts, and `.difflab` plan/review feedback in `~/.diffwiki/meta/transcripts/`.

## Skills

- `dw-install`: install the diffwiki CLI.
- `dw-init`: set up a wiki collection and configure recall context.
- `dw-remember`: create or update one templated draft routed to the best-fit collection by subject (including nested subpaths such as `react/tanstack` or `python/pydantic`), with `--research` for verified references.
- `dw-forget`: remove articles from `defaultCollection` or a named collection after search confirmation, or remove collections via `diffwiki collection remove` (asking before `--force` when articles remain).
- `dw-recall`: fetch relevant entries as compact snippets while honoring `context.collections` and excluding system content.
- `dw-sync`: run `diffwiki pull --json` then `diffwiki push --json` against the user's linked GitHub repository, joining an open pull request across repeated syncs and never merging unless requested.
- `dw-lint`: run `diffwiki lint` and offer to tighten failures via `dw-reviewer`.
- `dw-learn`: mine a source into deduplicated drafts across `session`, `history`, and `repo` modes, capturing verbatim harness sessions and `.difflab` feedback into `transcripts` metadata and drafting approved candidates (`--yes` or `--auto` skips confirmation).
- `dw-dream`: run a periodic improve, dedupe, and prune pass using `transcripts` and source metadata (safe-by-default: drafts and deprecations only).
- `dw-help`: explain the diffwiki CLI and installed `dw-*` skills.

## Raw sources

Skills retain verbatim harness sessions, human review feedback, original requests, role-labeled outputs, and source snippets alongside articles. See [Source metadata and provenance](architecture/source-metadata.md) for storage, templates, capture flows, and the boundary between CLI article writes and direct metadata edits.

## Agents & Technical Writing Guide

- `dw-author`: writes or rewrites one entry following its template and `references/technical-writing-guide.md`, preserving human-authored text that passes lint on updates.
- `dw-reviewer`: lints and tightens entries to enforce token budgets, references, and `references/technical-writing-guide.md`.
- `dw-researcher`: gathers and verifies references before authoring.

Agents and `references/technical-writing-guide.md` copy into every skill from `skills/shared/`. The guide enforces five rules plus a mandatory second pass:
1. Use the `/simple-english` skill for all writing (simple language, short sentences, unambiguous domain diction).
2. Keep artifacts as terse as possible.
3. Avoid walls of text.
4. Avoid inline references to specific files or classes and long historical inventories in prose (place them in appendix summary tables at the end only if needed).
5. Prefer Mermaid or draw.io diagrams for system architecture, workflows, and processes, omitting prose when a diagram explains the point completely.
6. Take a second pass to shorten and simplify further.

## Authoring shapes

Each entry conforms to a template shape with a token budget, starts at `status: draft` until promoted, and carries real references:

| Shape | Purpose | Budget |
|---|---|---|
| `guide` | Explains the reasoning behind a topic and connects related patterns | 1500–5000 tok |
| `recipe` | Documents one contained pattern with a single canonical example | 50–1000 tok |
| `recipe-with-steps` | Gives an ordered sequence of steps | 100–1500 tok |
| `reference` | Describes commands, flags, configuration keys, types, or APIs | 300–2000 tok |
| `collection-index` | Groups and links a collection's articles by topic without prose | 100–500 tok |

Shapes are discovered via `diffwiki templates list`. Customize or add shapes in `~/.diffwiki/templates/`.
