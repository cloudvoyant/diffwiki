# diffwiki agent skills

Agent-agnostic skills for diffwiki. Each skill is a standard `SKILL.md` package ([agentskills.io](https://agentskills.io)) that installs as one self-contained folder via the `skills` CLI and runs on any compatible agent (Claude Code, Antigravity, Cursor, Codex, Gemini CLI, OpenCode, Goose, pi).

## Skills

- `dw-install`: install the diffwiki CLI.
- `dw-init`: set up a wiki collection and configure recall context.
- `dw-remember`: create or update one templated draft routed to the best-fit collection (including nested paths such as `react/tanstack`).
- `dw-forget`: remove articles from `defaultCollection` or a named collection, or remove collections via `diffwiki collection remove`.
- `dw-recall`: fetch relevant entries as compact snippets while excluding `system` content.
- `dw-sync`: pull `origin/main` and push non-draft updates to `origin/user/<username>`, joining or opening a single pull request on the linked GitHub repository (never merges unless requested).
- `dw-lint`: run `diffwiki lint` and offer fixes via `dw-reviewer`.
- `dw-learn`: capture raw harness sessions and `.difflab` plan/review feedback into `transcripts` metadata, propose learning candidates, and draft approved entries across `session`, `history`, and `repo` modes.
- `dw-dream`: run a periodic improve, dedupe, and prune pass using `transcripts` and source metadata.
- `dw-help`: explain the diffwiki CLI and installed `dw-*` skills.

## Shared assets (`shared/` + build)

Each skill stays inside its own folder with no cross-skill imports. Shared agents and reference guides live in `skills/shared/` and copy into every skill at build time:

- `shared/agents/`: `dw-author`, `dw-reviewer`, `dw-researcher`.
- `shared/references/technical-writing-guide.md`: five writing rules (use `/simple-english`, keep artifacts terse, avoid walls of text, avoid inline file/class lists, prefer Mermaid or draw.io diagrams) plus a mandatory second pass to shorten further.
- `shared/references/source-capture.md`: raw source and metadata capture workflow.

```bash
mise run skills:build      # copy shared/* into every skill (commit the result)
mise run skills:validate   # check vendor drift, frontmatter, and self-containment
```

Edit `shared/`, run `mise run skills:build`, and commit the result. Skill-specific references (such as `routing.md` in `dw-remember` and `dw-recall`) stay in that skill's own `references/` folder.

## Templates

Authoring and metadata templates ship with the `diffwiki` CLI and copy into `~/.diffwiki/templates` via `diffwiki templates init`. Run `diffwiki templates list` to inspect available shapes.

## Install

```bash
npx agentskills install diffwiki/dw-install
```

If you install skills before diffwiki, run `/dw-install` to install the CLI, then run `/dw-init` to seed templates and configure a wiki.
