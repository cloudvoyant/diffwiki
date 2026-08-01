# diffwiki agent skills

Claude-Code / agent skills for diffwiki. Install via the agentskills CLI (they are standard `SKILL.md` packages); agents are in `agents/`.

## Skills
- `dw-install` — bootstrap diffwiki + seed `~/.diffwiki/templates`.
- `dw-init` — guided wiki setup + recall context.
- `dw-remember` — create/update one tight, templated draft (routes project vs knowledge-base).
- `dw-recall` — fetch relevant entries as compact snippets (never surfaces system content).
- `dw-lint` — run `diffwiki lint`; offer fixes via dw-reviewer.
- `dw-learn` — learn knowledge from a source and mine it into drafts: `session` (this conversation, default), `history` (past project sessions), or `repo` (a local/external codebase). Session/history capture into the hidden `transcripts` collection first.
- `dw-dream` — periodic improve/dedupe/prune using the transcripts collection.

## Agents
- `dw-author`, `dw-reviewer`, `dw-researcher` — template-bound, brevity-obsessed.

## Shared
- `shared/templates/` — the six templates; `shared/taxonomy.md` — authoring rules; `shared/transcript-hints.md` — per-tool transcript locations.

## Install
```bash
npx agentskills install diffwiki/dw-install   # or the published agentskills id
```
If you installed the skills before diffwiki, run `/dw-install` to bootstrap the CLI. Templates resolve from `~/.diffwiki/templates` (user-overridable), seeded by `/dw-install` / `/dw-init`.
