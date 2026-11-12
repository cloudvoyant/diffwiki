# Agent skills

The agent skills are a layer on top of the diffwiki CLI. The CLI writes articles and allocates source records. Skills fill the source-record Markdown directly so original quotations, raw harness sessions, and human review feedback stay intact.

diffwiki ships `dw-*` skills for authoring, forgetting, recalling, linting, learning, and maintaining the wiki. Install them via the agentskills CLI; if you install them before diffwiki, run `/dw-install` to bootstrap the CLI.

## CLI surface for skills

| Command | Purpose |
|---|---|
| `diffwiki lint [-c current\|all\|<names>]` | Lint entries against the template shapes (frontmatter, token budgets, references, drafts, tag leaks). Exit 1 on error. Skips system collections. |
| `diffwiki search query -c a,b,c` | Search a comma-separated **set** of collections. |
| `diffwiki collection create <name> --hidden` | Create a hidden **system-audience** collection (e.g. `transcripts`). |
| `diffwiki article create "<[collection[/subpath]:]title>" …` | Create an article (supports nested collection subpaths with a clean leaf title). |
| `diffwiki article remove "<[collection[/subpath]:]slug>"` | Remove an article from a named collection or `defaultCollection`. |
| `diffwiki config set showSystem true` | Reveal system-audience content in search, nav, and the UI. |

`diffwiki.yaml` supports a recall context:
```yaml
context:
  collections: [my-repo, react, python]
```

## The `system` audience & transcripts

`system` is a third audience (with `public`/`private`) for diffwiki-internal content. System collections and articles are hidden by default from `dw-recall`, search, lint, and the site, and revealed with `showSystem`. `dw-learn` captures structured session summaries in the hidden `transcripts` collection (`transcripts:<project>/<date>-<id>`, `--audience system`) while storing the verbatim raw harness session, session artifacts, and `.difflab` plan/review feedback in `~/.diffwiki/meta/transcripts/`.

## Skills

- **dw-install** — install the diffwiki CLI.
- **dw-init** — guided wiki setup and recall context.
- **dw-remember** — create or update one tight, templated **draft**; routes to the best-fit collection by subject (encouraging nested subpaths like `react/tanstack` or `python/pydantic`) and shows the proposed target collection; supports `--research` for verified references.
- **dw-forget** — remove articles from the configured `defaultCollection` or a specific collection after search confirmation.
- **dw-recall** — fetch relevant entries as compact snippets; honors `context.collections`; never surfaces system content.
- **dw-lint** — wraps `diffwiki lint`; offers to tighten failures via `dw-reviewer`.
- **dw-learn** — mine a source into deduped drafts across three modes: `session` (the current conversation, focused on general reusable learnings), `history` (past project sessions), and `repo` (a local or external codebase). Captures verbatim harness sessions and `.difflab/plans` + `.difflab/reviews` feedback into `transcripts` metadata, proposes learning candidates upfront (with target nested collection, shape, and `CREATE`/`UPDATE` action), and drafts only after user selection (unless `--yes` / `--auto` or prior auto-draft permission is present).
- **dw-dream** — periodic improve/dedupe/prune pass using `transcripts` and source metadata; safe-by-default (drafts and deprecations only).
- **dw-help** — explain the diffwiki CLI and available `dw-*` skills.

## Raw sources

Skills retain verbatim harness sessions, human review feedback, original requests, role-labeled outputs, and source snippets alongside articles. See [Source metadata and provenance](architecture/source-metadata.md) for storage, templates, capture flows, and the boundary between CLI article writes and direct metadata edits.

## Agents & Technical Writing Guide

- **dw-author** — writes or rewrites one entry; follows the template and `references/technical-writing-guide.md`; returns a complete article (frontmatter + body); on updates, preserves human-authored text that passes lint.
- **dw-reviewer** — lint-and-tighten; enforces budget, references, and `references/technical-writing-guide.md`; preserves correct human-authored text.
- **dw-researcher** — gathers and verifies references before authoring.

Agents and `references/technical-writing-guide.md` are vendored into every skill from `skills/shared/`. The guide enforces five rules plus a mandatory second pass:
1. Use the `/simple-english` skill for all writing (simple language, short sentences, unambiguous domain diction).
2. Keep artifacts as terse as possible.
3. Avoid walls of text.
4. Avoid inline references to specific files or classes and long historical inventories in prose (place them in appendix summary tables at the end only if needed).
5. Prefer Mermaid or draw.io diagrams for system architecture, workflows, and processes; omit prose when a diagram explains the point completely.
- Always take a second pass to check if the writing can be shortened or simplified further.

## Authoring shapes

Each entry conforms to a template shape with a token budget, ships `status: draft` until promoted, and carries real references:

| Shape | Purpose | Budget |
|---|---|---|
| `guide` | Teaches the reasoning behind a topic — connects related patterns and explains why they work | 1500–5000 tok |
| `recipe` | One contained pattern with a single canonical example | 50–1000 tok  |
| `recipe-with-steps` | An ordered sequence — do X, then Y, then Z | 100–1500 tok |
| `reference` | Authoritative description of commands, flags, config keys, types, or APIs | 300–2000 tok |
| `collection-index` | Groups and links a collection's articles by topic — headings and bullet links only, no prose | 100–500 tok |

Shapes are discovered via `diffwiki templates list`. Customize or add shapes in `~/.diffwiki/templates/`.
