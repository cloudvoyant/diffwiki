---
name: dw-init
description: Guided diffwiki setup for a project or repo. Triggers on "dw init", "set up a wiki", "initialize diffwiki", "create a wiki collection". Sets up an in-repo or global collection and the recall context.
---

# dw-init

Guided setup. Run the diffwiki CLI for every mutation — never edit registry/state files directly. Read `references/setup.md` for exact commands.

## Steps

1. **Detect context.** Run `git rev-parse --show-toplevel 2>/dev/null` to see if we're in a repo, and `diffwiki collection list` to show existing collections. Seed the authoring templates (idempotent, never overwrites): `diffwiki templates init`.

2. **Ask location** (AskUserQuestion, "Where should this wiki live?"):
   - _In this repo_ (recommended when in a repo) — an in-repo collection under `wiki/` or your preferred in-repo location, tracked in git with the code.
   - _Global_ — a collection under in your global git backed wiki (`~/.diffwiki/collections`), shared across projects.

3. **Create it.**
   - In-repo: ask for the collection name (default = repo name) and path (default `wiki`), then run `diffwiki collection init -c <name> -p <path>`.
   - Global: ask for the name, then `diffwiki collection create <name>`.

4. **Set recall context** (only meaningful in-repo). Show the current `diffwiki collection list` and ask (multi-select) which collections `dw-recall` should search from within this repo — typically this repo's collection plus any collections dedicated to the topic (language, framework, or subject). Apply it with `diffwiki context set <a,b,c>` (see `references/setup.md`) — never hand-edit `diffwiki.yaml`.

5. **Offer indexing.** If a search plugin is installed (`diffwiki plugin list`), offer to run `diffwiki search index`.

6. **Confirm.** Print the collection path, the `context.collections`, and next steps: `/dw-remember` to add knowledge, `/dw-recall` to search.

## Rules

- One AskUserQuestion per decision; sensible defaults; never chain needless questions.
- Mutate collections/config only via the `diffwiki` CLI — no direct filesystem writes. Recall context goes through `diffwiki context set`; template seeding through `diffwiki templates init`.
- Ensure `~/.diffwiki/templates` is seeded (`diffwiki templates init`, step 1) so the authoring skills/agents find the templates.
- If not in a git repo and the user picked in-repo, offer to `git init` first.
