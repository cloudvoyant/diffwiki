---
name: dw-install
description: Bootstrap diffwiki for the agent skills. Triggers on "dw install", "set up diffwiki", "install diffwiki", or when a dw-* skill reports diffwiki is missing. Installs the diffwiki CLI if absent, seeds ~/.diffwiki/templates, and offers to initialize a wiki.
---

# dw-install

Ensure the `diffwiki` CLI and the shared authoring assets are present. Run this when a `dw-*` skill can't find `diffwiki`.

## Steps

1. **Detect.** `diffwiki --version`. If it prints a version, skip to step 3.
2. **Install the CLI.** `npm i -g diffwiki` (fallback: `pnpm add -g diffwiki`). Re-run `diffwiki --version`. If it still fails, tell the user to install Node ≥ 20 / npm and stop.
3. **Seed templates.** For each file in this skill's `assets/templates/` and `assets/taxonomy.md`, copy it into `~/.diffwiki/templates/` ONLY if the destination does not already exist (user overrides win):
   ```bash
   mkdir -p ~/.diffwiki/templates
   for f in "$SKILL_DIR"/assets/templates/*.md "$SKILL_DIR"/assets/taxonomy.md; do
     dest=~/.diffwiki/templates/"$(basename "$f")"
     [ -e "$dest" ] || cp "$f" "$dest"
   done
   ```
   (`$SKILL_DIR` = this skill's directory.)
4. **Health check.** `diffwiki doctor`; report any ✖.
5. **Offer setup.** Suggest `/dw-init` to create a wiki, and confirm the other `dw-*` skills are ready.

## Rules
- Never overwrite existing `~/.diffwiki/templates/*` — user templates win.
- Idempotent; safe to re-run.
- Install ONLY the global `diffwiki` package; touch nothing else.
