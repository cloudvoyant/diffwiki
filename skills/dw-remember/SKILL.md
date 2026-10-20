---
name: dw-remember
description: Create or update diffwiki knowledge. Triggers on "dw remember", "remember this", "add to the wiki", "capture this", "save a recipe/guide". Routes to the best-fit collection by subject, picks the right template shape, writes a draft, and shows it. Accepts --research to gather references first.
---

# dw-remember

Turn one piece of knowledge into one tight, template-conformant diffwiki draft. Write articles through the CLI. Fill source-record Markdown directly after CLI allocation; see `references/source-capture.md`.

## Inputs
- The knowledge to capture (from the user or a calling agent).
- `--research` / "research first" → gather references before authoring.
- Whether this is a NEW entry or an UPDATE to an existing one.

## Steps

1. **Clarify the memory.** If the user was vague, ask one question: what exactly should be captured, and is it new or an update? If a calling agent invoked you, use the payload as-is.

2. **Route** (see `references/routing.md`). List the collections that exist (`diffwiki collection list` + the repo `diffwiki.yaml`) and pick the **best-fit by subject** — the repo's own collection for project-specific knowledge, or the collection dedicated to the topic (language/framework/tool/subject) for reusable knowledge. Do NOT assume a fixed structure. If nothing fits well, propose creating a new collection. Show the chosen `collection:Title` and confirm if ambiguous.

3. **Preserve inputs and pick the template.** Read `references/source-capture.md` and retain the raw input packet before summarizing. On UPDATE, read the existing article and its metadata. Discover article shapes with `diffwiki templates list --json`; use the effective template `path` (see `references/templates.md`). If the list is empty, run `diffwiki templates init`.

4. **Research (if asked).** Dispatch the `dw-researcher` agent with the topic and shape; collect its verified reference list + facts.

5. **Author.** Dispatch the `dw-author` agent with: the target shape, the template path, the source knowledge, and any research. It returns a complete article (frontmatter + body). If it returns `BLOCKED:`, resolve the blocker (usually: split into two entries, or get references) and retry.

6. **Write as a draft.** Extract the body (content after the closing `---` of the frontmatter) from the agent's output. `<Title>` is a short human-readable phrase in Title Case (e.g. `Add a Subcommand`) — NEVER a path or slug; the CLI slugifies the filename for you. Read the suggested tags from the agent's frontmatter. NEW:
   ```bash
   diffwiki article create "<collection>:<Title>" -b "$(cat /tmp/dw-body.md)" -t "<tag1>,<tag2>" --status draft
   ```
   UPDATE (target is `collection:slug`):
   ```bash
   diffwiki article update "<collection>:<slug>" -b "$(cat /tmp/dw-body.md)" -t "<tag1>,<tag2>" --status draft
   ```
   Tags: the shape tag + topic tags from the agent's frontmatter; NEVER `diffwiki-template`.

7. **Capture sources, then tighten.** Use the exact saved article filename to allocate/fill history and any external-extract records through `references/source-capture.md`. Keep collection-wide captures linked rather than duplicated. Run `diffwiki lint -c <collection>`. If the entry has any ✖, dispatch `dw-reviewer`, update the article, and re-run lint (max 2 passes). Tighten only article prose, never raw source records. Reindex and report the source paths with the draft. If capture fails, keep the packet and saved article path for retry.

8. **Show it (direct invocation only).** If a human invoked this skill directly (not another agent), print the drafted entry so they can review: `diffwiki article edit "<collection>:<slug>" --editor cat` OR read and print the file. State that it is a **draft** and how to promote it (`diffwiki article update "<collection>:<slug>" --status published`).

## Rules
- Every entry ships `--status draft`. Promotion to `published` is a separate, human/reviewer act.
- Do not edit article frontmatter directly. Use CLI flags for the saved article. The author's returned frontmatter supplies suggested values; source-record Markdown follows `references/source-capture.md`.
- One entry per invocation. If the knowledge spans shapes, create multiple entries and link them.
- Keep it tight: the author/reviewer agents enforce the budget; do not pad.
