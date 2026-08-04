# diffwiki agent skills

Agent-agnostic skills for diffwiki. Each is a standard `SKILL.md` package ([agentskills.io](https://agentskills.io)), so it installs one self-contained folder at a time via the `skills` CLI and runs on any skills-compatible agent (Claude Code, Cursor, Codex, Gemini CLI, opencode, …).

## Skills
- `dw-install` — install the diffwiki CLI.
- `dw-init` — guided wiki setup + recall context.
- `dw-remember` — create/update one tight, templated draft (routes to the best-fit collection by subject).
- `dw-recall` — fetch relevant entries as compact snippets (never surfaces system content).
- `dw-lint` — run `diffwiki lint`; offer fixes via dw-reviewer.
- `dw-learn` — learn knowledge from a source and mine it into drafts: `session` (this conversation, default), `history` (past project sessions), or `repo` (a local/external codebase). Session/history capture into the hidden `transcripts` collection first.
- `dw-dream` — periodic improve/dedupe/prune using the transcripts collection.

## Shared assets (`shared/` + build)
The standard scopes each skill to its own folder — no cross-skill imports. So shared agents and reference docs live once in **`skills/shared/`** (the source of truth) and are **vendored into every skill** at build time, keeping each skill self-contained.

- `shared/agents/` — `dw-author`, `dw-reviewer`, `dw-researcher` (template-bound, brevity-obsessed). `dw-author`/`dw-reviewer` write in Simple Technical English per the guide below.
- `shared/references/technical-writing-guide.md` — Simple Technical English (ASD-STE100), condensed from [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish). It references `checklist.md` and `use-cases.md` (same dir).

```bash
mise run skills:build      # copy all of shared/* into every skill (commit the result)
mise run skills:validate   # fail on vendor drift, bad frontmatter, or non-self-contained refs
```

Edit `shared/`, run `skills:build`, and commit the result — the vendored copies are committed because `npx skills` installs straight from the repo. CI runs `skills:validate`, so a drift or a broken skill fails the build. Why share this way is documented in the wiki: `agent-skills/Share Assets and Agents Across a Set of Skills`.

Per-skill references that are **not** shared (e.g. `routing.md` in `dw-remember` and `dw-recall`) live in that skill's own `references/` and are not managed by the build.

## Templates
Authoring templates ship with the `diffwiki` CLI and are seeded into `~/.diffwiki/templates` (user-overridable) by `diffwiki templates init`. Each template is self-describing (`shape`/`purpose`/`budget` in frontmatter) — run `diffwiki templates list` to see available shapes.

## Install
```bash
npx agentskills install diffwiki/dw-install   # or the published agentskills id
```
If you installed the skills before diffwiki, run `/dw-install` to install the CLI, then `/dw-init` (which runs `diffwiki templates init`) to seed templates and set up a wiki.
