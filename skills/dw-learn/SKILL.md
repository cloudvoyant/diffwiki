---
name: dw-learn
description: Learn durable wiki knowledge from a source. Triggers on "dw learn", "learn from this session", "capture what we did", "mine my sessions", "learn from a repo", "learn from a codebase". Dispatcher — pass a mode (session for this conversation, history for past project sessions, repo for a local or external codebase); bare "dw learn" defaults to session. Proposes learning candidates upfront and drafts only after user selection (or with --yes/--auto or prior permission). Mutates only via the diffwiki CLI; every entry is a draft.
---

# dw-learn

Turn a source into tight, template-conformant knowledge drafts. Pick a **mode** by source:

| Mode | Source | Focus | Reference |
|---|---|---|---|
| `session` (default) | the current live conversation + `.difflab` plans/reviews | **General, reusable engineering learnings** (never repo-specific architecture/implementation details) | `references/session.md` |
| `history` | past on-disk harness sessions + `.difflab` plans/reviews for this project | Reusable learnings and repeated workflow patterns across sessions | `references/history.md` |
| `repo` | a local or external code repository | Repository architecture, patterns, and domain reference | `references/repo.md` |

Write articles through the `diffwiki` CLI (and `dw-remember`). Preserve raw inputs with `references/source-capture.md`; fill CLI-allocated metadata records directly. Read and follow `references/technical-writing-guide.md` (and invoke `/simple-english`) for all drafted articles. If `diffwiki` is missing, run `/dw-install`.

## Flags & Auto-Draft Permission
- `--yes` or `--auto`: skip the interactive candidate selection gate and automatically draft all proposed candidates.
- Prior user permission (e.g. "auto-draft", "just draft them all"): treated the same as `--yes`.
- Without `--yes`/`--auto` or prior permission, `dw-learn` **must** present the proposed candidates (with target nested collection, shape, and `CREATE`/`UPDATE` action) and wait for the user's selection and any custom additions before calling `dw-remember`.

## Dispatch

1. **Parse the mode and flags** from the arguments. Normalize mode: empty → `session`; `current`/`this` → `session`; `past`/`sessions` → `history`; `code`/`codebase` → `repo`. Recognize `--yes` and `--auto` anywhere in the arguments. Everything else after the mode token is that mode's input (e.g. a repo path or URL for `repo`, or a user hint on what to focus on). If the first token is free-text prose rather than a mode/alias, treat it as `session`; if it is ambiguous, show the three modes and ask.
2. **Run the mode.** Read and follow `references/<mode>.md` to capture verbatim raw session/review data into `transcripts` metadata and write the session transcript summary. Every mode ends by running the shared proposal and drafting pipeline in `references/mine.md`.

## Rules (all modes)
- **Upfront candidate gate:** Always propose candidates first (showing title, nested target collection path, shape, and `CREATE`/`UPDATE` action) and let the user select one or more candidates, adjust target collections, or add custom topics. Proceed to drafting **only** after user selection, OR when `--yes`/`--auto` is passed, OR when the user has already granted permission to auto-draft.
- **General focus in `session` mode:** Default/`session` mode must extract **general, reusable engineering learnings** (language/framework idioms, tool recipes, debugging techniques, general design patterns, and agent workflow rules corrected by human review feedback). Do **not** repeat repo-specific architecture, file layouts, or one-off implementation details of the current repo in `session` mode.
- **Verbatim raw capture + `.difflab` review mining:** In `session` and `history` modes, store the literal raw session from the active harness, session artifacts, and `.difflab/plans/` + `.difflab/reviews/` feedback into `~/.diffwiki/meta/transcripts/` (`diffwiki meta new "transcripts:<project>/<file>.md" --template history --json` + `.meta/attachments/<record-id>/`), and summarize them in the `transcripts` article. Human reviewer comments and plan revision feedback are primary signal for what the user values and corrects in agent behavior.
- **Technical writing standards:** Every drafted article must follow `references/technical-writing-guide.md` (use `/simple-english`, keep artifacts terse, avoid walls of text and inline file/class lists, prefer Mermaid/draw.io diagrams, and take a mandatory second pass to shorten further).
- Knowledge drafts ship `status: draft`; nothing auto-publishes. Session/history transcripts are `--audience system` (hidden).
- Prefer UPDATE over duplicate CREATE when mining (dedupe via `dw-recall`). Keep every entry in its template budget — brevity over completeness.
- Never fabricate references; use `dw-remember --research` for candidates needing verified sources.
- Never write secrets/tokens seen in a session or repo — redact.
