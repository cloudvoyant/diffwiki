# diffwiki agent skills

Agent-agnostic skills for diffwiki. Each is a standard `SKILL.md` package ([agentskills.io](https://agentskills.io)) that installs as one self-contained folder via the `skills` CLI and runs on any skills-compatible agent (Claude Code, Antigravity, Cursor, Codex, Gemini CLI, OpenCode, Goose, pi).

## Skills
- `dw-install` — install the diffwiki CLI.
- `dw-init` — guided wiki setup and recall context.
- `dw-remember` — create or update one tight, templated draft routed to the best-fit (and nested, e.g. `react/tanstack`, `python/pydantic`) collection by subject.
- `dw-forget` — remove one or more articles from the configured `defaultCollection` or a specific collection.
- `dw-recall` — fetch relevant entries as compact snippets (never surfaces system content).
- `dw-lint` — run `diffwiki lint` and offer fixes via `dw-reviewer`.
- `dw-learn` — capture raw harness sessions, session artifacts, and `.difflab` review/plan feedback into `transcripts` metadata, propose learning candidates upfront (with target nested collection, shape, and `CREATE`/`UPDATE` action), and draft approved candidates (`--yes` / `--auto` to skip confirmation). Supports `session` (default, focused on general reusable learnings), `history` (past project sessions), and `repo` (a local/external codebase).
- `dw-dream` — periodic improve/dedupe/prune pass using the `transcripts` collection and source metadata.
- `dw-help` — explain the diffwiki CLI and available `dw-*` skills.

## Shared assets (`shared/` + build)
Each skill is scoped to its own folder with no cross-skill imports. Shared agents and reference docs live once in **`skills/shared/`** and are **vendored into every skill** at build time:

- `shared/agents/` — `dw-author`, `dw-reviewer`, `dw-researcher`.
- `shared/references/technical-writing-guide.md` — five core technical writing rules (use `/simple-english`, keep artifacts terse, avoid walls of text, avoid inline file/class lists and historical inventories, prefer Mermaid/draw.io diagrams) plus a mandatory second pass to shorten and simplify further.
- `shared/references/source-capture.md` — raw source and metadata capture workflow.

```bash
mise run skills:build      # copy all of shared/* into every skill (commit the result)
mise run skills:validate   # fail on vendor drift, bad frontmatter, or non-self-contained refs
```

Edit `shared/`, run `mise run skills:build`, and commit the result. Per-skill references that are not shared (such as `routing.md` in `dw-remember` and `dw-recall`) live in that skill's own `references/`.

## Templates
Authoring and metadata templates ship with the `diffwiki` CLI and are seeded into `~/.diffwiki/templates` by `diffwiki templates init`. Run `diffwiki templates list` to inspect available shapes.

## Install
```bash
npx agentskills install diffwiki/dw-install
```
If you install the skills before diffwiki, run `/dw-install` to install the CLI, then `/dw-init` to seed templates and set up a wiki.
