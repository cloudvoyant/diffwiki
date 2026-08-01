---
name: dw-remember
description: Create or update diffwiki knowledge. Triggers on "dw remember", "remember this", "add to the wiki", "capture this", "save a recipe/guide". Routes project vs knowledge-base wikis, picks the right template, writes a draft, and shows it. Accepts --research to gather references first.
---

# dw-remember

Turn one piece of knowledge into one tight, template-conformant diffwiki draft. Mutate ONLY through the `diffwiki` CLI — it owns frontmatter and slugging.

## Inputs
- The knowledge to capture (from the user or a calling agent).
- `--research` / "research first" → gather references before authoring.
- Whether this is a NEW entry or an UPDATE to an existing one.

## Steps

1. **Clarify the memory.** If the user was vague, ask one question: what exactly should be captured, and is it new or an update? If a calling agent invoked you, use the payload as-is.

2. **Route** (see `references/routing.md`). Decide the target collection:
   - Project-specific knowledge (this repo's architecture, conventions, gotchas) → the repo's collection (from `diffwiki collection list` / the repo `diffwiki.yaml`).
   - General reusable knowledge (a language/tool pattern) → `knowledge-base` or the matching language collection.
   Show the chosen `collection:Title` and confirm if ambiguous.

3. **Pick the shape + template** (see `references/templates.md` and `~/.diffwiki/templates/taxonomy.md`). Resolve the template file from `~/.diffwiki/templates/<shape>-template.md` (seeded by `/dw-install`; if missing, run `/dw-install`).

4. **Research (if asked).** Dispatch the `dw-researcher` agent with the topic and shape; collect its verified reference list + facts.

5. **Author.** Dispatch the `dw-author` agent with: the target shape, the template path, the source knowledge, and any research. It returns a BODY (no frontmatter). If it returns `BLOCKED:`, resolve the blocker (usually: split into two entries, or get references) and retry.

6. **Write as a draft.** Save the body to a temp file and call the CLI. NEW:
   ```bash
   diffwiki article create "<collection>:<Title>" -b "$(cat /tmp/dw-body.md)" -t "<tag1>,<tag2>" --status draft
   ```
   UPDATE (target is `collection:slug`):
   ```bash
   diffwiki article update "<collection>:<slug>" -b "$(cat /tmp/dw-body.md)" -t "<tag1>,<tag2>" --status draft
   ```
   Tags: the shape tag + topic tags; NEVER `diffwiki-template`.

7. **Lint + tighten.** Run `diffwiki lint -c <collection>`. If the new entry has any ✖, dispatch `dw-reviewer` with the file and findings, take its tightened body, and re-run the `article update` from step 6. Repeat until lint is clean (max 2 passes).

8. **Show it (direct invocation only).** If a human invoked this skill directly (not another agent), print the drafted entry so they can review: `diffwiki article edit "<collection>:<slug>" --editor cat` OR read and print the file. State that it is a **draft** and how to promote it (`diffwiki article update "<collection>:<slug>" --status published`).

## Rules
- Every entry ships `--status draft`. Promotion to `published` is a separate, human/reviewer act.
- Frontmatter is never hand-written — only `-b`, `-t`, `--status`, `--audience`.
- One entry per invocation. If the knowledge spans shapes, create multiple entries and link them.
- Keep it tight: the author/reviewer agents enforce the budget; do not pad.
