---
name: dw-learn
description: Learn from your agent sessions and draft many wiki entries. Triggers on "dw learn", "learn from this session", "capture what we did", "mine my sessions into the wiki". Captures the current + past project sessions into a hidden transcripts collection, then mines them into deduped drafts.
---

# dw-learn

Capture this project's agent sessions, then mine them into tight knowledge drafts. Mutate only via the `diffwiki` CLI (and `dw-remember`). If `diffwiki` is missing, run `/dw-install`.

## Phase A — Capture

1. **Ensure the store.** If `diffwiki collection list` lacks `transcripts`, create it hidden: `diffwiki collection create transcripts --hidden`.
2. **Identify the project.** Use the repo name (git toplevel basename) or cwd basename as `<project>`.
3. **Current session.** Introspect your own conversation and fill the `~/.diffwiki/templates/session-transcript-template.md` shape: Worked on / Issues & learnings / Decisions & patterns / Key tool actions / Open threads. Terse and factual.
4. **Historical sessions (best-effort, project-scoped).** Follow `references/capture.md`: locate YOUR tool's past transcripts, keep only those whose working dir is this project, and normalize each into the same shape. Skip sessions already captured (a matching `transcripts/<project>/…` entry exists).
5. **Write each transcript:**
   ```bash
   diffwiki article create "transcripts:<project>/<YYYY-MM-DD>-<shortid>" \
     -b "$(cat /tmp/dw-transcript.md)" -t "transcript,<tool>,<project>" --audience system
   ```
   These land in the hidden `transcripts` collection — invisible to `dw-recall` and the UI unless `showSystem` is on.

## Phase B — Mine

6. **Read the project's transcripts.** `diffwiki search query "" -c transcripts` (explicit `-c` reveals the hidden collection), filtered to `<project>` entries; read their bodies.
7. **Cluster nuggets.** Per `references/harvest.md`, extract distinct durable knowledge (a recurring problem→fix → recipe; a multi-step setup → recipe-steps; a workflow → guide; a decision → the relevant shape). Discard one-off chatter.
8. **Dedupe.** For each candidate, `dw-recall <keywords>`; if the wiki already covers it, mark as UPDATE (or drop).
9. **Draft.** For each approved candidate, invoke `dw-remember` (create/update, `status: draft`). Batch mode — don't show each entry individually.
10. **Summarize.** List transcripts captured and drafts created/updated, then `diffwiki lint -c <touched collections>` and report health.

## Rules
- Transcripts are `--audience system` (hidden); knowledge drafts are `status: draft`. Nothing auto-publishes.
- Capture only THIS project's sessions. Prefer UPDATE over duplicate CREATE when mining.
- Keep each entry in budget; split oversized nuggets. Brevity over completeness.
- Never fabricate references; use `dw-remember --research` for candidates needing verified sources.
