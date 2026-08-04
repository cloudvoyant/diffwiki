# Agent skills

The agent skills are a layer on top of the diffwiki CLI. The CLI does the work — authoring, recall, linting, search — and the skills package that behavior so agentic environments (Claude Code and other agents) can drive it from inside a session. Skills mutate the wiki only through CLI commands; nothing bypasses it.

diffwiki ships `dw-*` skills for authoring, recalling, linting, learning, and maintaining the wiki. Install them via the agentskills CLI; if you install them before diffwiki, run `/dw-install` to bootstrap the CLI.

## New CLI surface

| Command | Purpose |
|---|---|
| `diffwiki lint [-c current\|all\|<names>]` | Lint entries against the template shapes (frontmatter, token budgets, references, drafts, tag leaks). Exit 1 on error. Skips system collections. |
| `diffwiki search query -c a,b,c` | Search a comma-separated **set** of collections. |
| `diffwiki collection create <name> --hidden` | Create a hidden **system-audience** collection (e.g. `transcripts`). |
| `diffwiki article create … --audience system` | Mark an article system (hidden). |
| `diffwiki config set showSystem true` | Reveal system-audience content in search, nav, and the UI. |

`diffwiki.yaml` gains a recall context:
```yaml
context:
  collections: [my-repo, knowledge-base, typescript]
```

## The `system` audience & transcripts

`system` is a third audience (with `public`/`private`) for diffwiki-internal content. system collections/articles are hidden by default from `dw-recall`, search, lint, and the site — and revealed with `showSystem`. `dw-learn` uses this: it captures your agent sessions into a hidden `transcripts` collection (`transcripts/<project>/…`, `--audience system`), which it then mines into knowledge drafts.

## Skills

- **dw-install** — install the diffwiki CLI. (Templates ship with the CLI; `/dw-init` seeds them via `diffwiki templates init`.)
- **dw-init** — guided wiki setup + recall context.
- **dw-remember** — create/update one tight, templated **draft**; routes to the best-fit collection by subject; `--research` for verified references; shows the draft on direct use.
- **dw-recall** — fetch relevant entries as compact snippets; honors `context.collections`; never surfaces system content.
- **dw-lint** — wraps `diffwiki lint`; offers to tighten failures via `dw-reviewer`.
- **dw-learn** — learn knowledge from a source, then mine it into deduped drafts. Three modes: `session` (this conversation, the default), `history` (past project sessions), and `repo` (a local or external codebase). `session`/`history` capture into the hidden `transcripts` collection; `repo` reads a codebase directly (no transcript). Bare `/dw-learn` runs `session`.
- **dw-dream** — periodic improve/dedupe/prune using the transcripts collection; safe-by-default (drafts + deprecations only).

## Agents

- **dw-author** — writes or rewrites one entry; reads the template's authoring rules and Simple Technical English guide; returns a complete article (frontmatter + body); on updates, preserves human-authored text that passes lint.
- **dw-reviewer** — lint-and-tighten; enforces budget, references, and Simple Technical English; preserves correct human-authored text.
- **dw-researcher** — gathers and verifies references before authoring.

Agents ship bundled inside each skill and are vendored from `skills/shared/agents/`. They write in Simple Technical English per `skills/shared/references/technical-writing-guide.md` (ASD-STE100, condensed from [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish)).

## Authoring rules

Entries are tight snippets for LLM context — verbosity is a defect. Each conforms to a template shape with a token budget, ships `status: draft` until promoted, and carries real, researched references. The five bundled shapes are:

| Shape | Purpose | Budget |
|---|---|---|
| `guide` | Teaches the reasoning behind a topic — connects related patterns and explains why they work | 1500–5000 tok |
| `recipe` | One contained pattern with a single canonical example | 50–1000 tok  |
| `recipe-with-steps` | An ordered sequence — do X, then Y, then Z | 100–1500 tok |
| `reference` | Authoritative description of commands, flags, config keys, types, or APIs — consult while working | 300–2000 tok |
| `collection-index` | Groups and links a collection's articles by topic — headings and bullet links only, no prose | 100–500 tok |

Shapes are **discovered from the CLI, not hard-coded** — `diffwiki templates list` prints each shape, its purpose, and budget, read from that template's own frontmatter (`shape:`/`purpose:`/`budget:`). Customizing is just editing or dropping a `*-template.md` with those fields into `~/.diffwiki/templates/`.
