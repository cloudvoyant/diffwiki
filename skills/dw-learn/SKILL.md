---
name: dw-learn
description: Learn durable wiki knowledge from a source. Triggers on "dw learn", "learn from this session", "capture what we did", "mine my sessions", "learn from a repo", "learn from a codebase". Dispatcher — pass a mode (session for this conversation, history for past project sessions, repo for a local or external codebase); bare "dw learn" defaults to session. Mutates only via the diffwiki CLI; every entry is a draft.
---

# dw-learn

Turn a source into tight, template-conformant knowledge drafts. Pick a **mode** by source:

| Mode | Source | Reference |
|---|---|---|
| `session` (default) | the current live conversation | `references/session.md` |
| `history` | past on-disk sessions for this project | `references/history.md` |
| `repo` | a local or external code repository | `references/repo.md` |

Write articles through the `diffwiki` CLI (and `dw-remember`). Preserve raw inputs with `references/source-capture.md`; fill CLI-allocated metadata records directly. If `diffwiki` is missing, run `/dw-install`.

## Dispatch

1. **Parse the mode** from the first argument. Normalize: empty → `session`; `current`/`this` → `session`; `past`/`sessions` → `history`; `code`/`codebase` → `repo`. Everything after the mode token is that mode's input (e.g. a repo path or URL for `repo`). If the first token is free-text prose rather than a mode/alias, treat it as `session` (the user is describing what to capture); if it is ambiguous, show the three modes and ask.
2. **Run the mode.** Read and follow `references/<mode>.md`. Every mode ends by running the shared mine pipeline in `references/mine.md`.

## Rules (all modes)
- Knowledge drafts ship `status: draft`; nothing auto-publishes. Session/history transcripts are `--audience system` (hidden).
- Capture only THIS project's material — except `repo` mode, which may target an external repository the user names explicitly.
- Prefer UPDATE over duplicate CREATE when mining (dedupe via `dw-recall`). Keep every entry in its template budget — brevity over completeness.
- Never fabricate references; use `dw-remember --research` for candidates needing verified sources.
- Mine original user requests, role-labeled outputs, and source snippets. A summary or prior assistant claim cannot replace those inputs. Do not infer preferences, causes, or generalized lessons. If old transcript templates contain summary sections, still retain and pass the original evidence packet.
- Never write secrets/tokens seen in a session or repo — redact.
