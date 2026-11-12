# dw-learn — propose learning candidates, confirm, and draft

Shared back-half for every `dw-learn` mode. Input: verbatim raw session/review metadata records, transcript summary, and source snippets with their locations. Output: user-approved, source-backed `status: draft` entries via `dw-remember`. Read and follow `references/technical-writing-guide.md` and `references/source-capture.md`.

## 1. Extract and filter learning candidates
Select distinct, high-value nuggets supported by actual quotations, code, commands, or human review feedback. Match the article shape (`recipe`, `recipe-with-steps`, `guide`, `reference`) to that evidence:

- **In `session` (default) mode — GENERAL learning only:**
  - Keep **general, reusable learnings**: language/framework patterns, library usage, CLI/tooling recipes, debugging techniques, portable architectural trade-offs, and general agent/writing rules surfaced by human review comments or `.difflab` plan/review feedback.
  - **Exclude repo-specific implementation details:** do NOT propose articles that merely repeat this repository's internal file paths, class names, module wiring, or one-off feature plumbing.
- **Human review & plan feedback priority:** Treat human reviewer comments (in PR reviews, `.difflab/reviews/*/REVIEW.md`, or `.difflab/plans/*/revisions/*.md` `## Feedback`) and explicit user corrections in the session as highest-priority signal for what the user values and wants corrected in future work.
- Do not infer unstated root causes or fabricate claims. If support is missing, skip the candidate or flag it for `dw-remember --research`.

## 2. Route to nested collections
Use `dw-remember` routing (`references/routing.md` in `dw-remember`):
- Route each candidate to the best-fit collection and **encourage nested collection paths** (`<collection>/<subtopic>`) for better recall — e.g. React frameworks under `react/<framework>` (`react/nextjs`, `react/tanstack`), Python libraries under `python/<library>` (`python/pydantic`, `python/fastapi`), TypeScript tools under `typescript/<tool>`.
- Propose a new parent collection when nothing existing fits.

## 3. Dedupe via `dw-recall`
For each candidate, run `dw-recall` (`diffwiki search query "<keywords>"`). If an existing entry already covers the topic, mark the candidate `UPDATE (<collection>:<slug>)` instead of `CREATE`.

## 4. Propose candidates upfront (Approval Gate)
Before drafting any templates or calling `dw-remember`, check whether auto-drafting is authorized:
- **Auto-draft authorized** ONLY if `--yes` or `--auto` was passed, OR the user has already granted explicit permission to automatically draft articles.
- **Otherwise (default): STOP and present the proposed candidates to the user:**

```text
Proposed learning candidates:
  #  Action  Target Collection   Shape              Title — Summary (Source)
  1  CREATE  react/tanstack      recipe             Query Invalidation — Invalidate query keys after mutations (session msg #14)
  2  UPDATE  python/pydantic     recipe-with-steps  Custom Validators — Validate cross-field constraints in v2 (.difflab/reviews/...)
  3  CREATE  ai/agents           guide              Diagram-First Plans — Prefer Mermaid diagrams over prose (.difflab/plans/.../revisions/1.md)
```

Ask the user to:
1. **Select** one or more candidates (e.g. `1, 3`, `all`, or `none`),
2. **Adjust** any proposed target collection path if desired (since collection nesting is a matter of taste), and
3. **Propose additional specific topics** they want captured from the session.

Wait for the user's reply. If the user adds custom topics or changes a target collection, incorporate those selections before proceeding.

## 5. Draft approved candidates via `dw-remember`
For each approved candidate (and any user-added topic):
- Invoke `dw-remember` with the approved `<collection>[/<subpath>]:<Title>`, shape, and original evidence packet + metadata record links (`status: draft`).
- Ensure `dw-author` and `dw-reviewer` follow `references/technical-writing-guide.md`:
  1. Use `/simple-english` (simple language, short sentences, unambiguous domain diction).
  2. Keep artifacts as terse as possible.
  3. Avoid walls of text.
  4. Avoid inline file/class references and historical inventories in prose (use appendix summary tables at the end only if needed).
  5. Prefer Mermaid or draw.io diagrams where a diagram explains the architecture, workflow, or process; omit redundant prose when the diagram is complete.
  - Always take a second pass to shorten and simplify further.
- Cap a single batch pass at ~8 drafts unless the user selected more.

## 6. Summarize and lint
List the transcript and metadata records captured plus the drafts created/updated (with their target collection paths), then run `diffwiki lint -c <touched collections>` and report health.
