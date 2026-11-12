---
shape: session-transcript
purpose: dw-learn capture into the hidden transcripts collection (not linted).
---
<!-- SESSION TRANSCRIPT. Summarizes the session while verbatim raw harness logs,
session artifacts, and .difflab review/plan files are stored in
~/.diffwiki/meta/transcripts/ via `diffwiki meta new "transcripts:<project>/<file>.md" --template history`.
Goes into the hidden `transcripts` collection with `--audience system`; NOT linted
as a knowledge entry. Do not invent dialogue, causes, preferences, or lessons.
Title (passed to the CLI) is "<project>/<date>-<short-id>"; tags are
[transcript, <tool>, <project>]. Do not write frontmatter — the CLI owns it. -->

**Tool:** <claude-code|antigravity|codex|cursor|opencode|goose|pi|aider> · **Project:** <repo-or-path> · **Date:** <YYYY-MM-DD> · **Session:** <id-if-known>

## Session summary
- <1-3 bullet summary of the goal, approach, and outcome>

## Raw user requests
- <exact quotation, original time, session/message location>

## Reviews and plan feedback (.difflab & human reviewer comments)
- <summary and exact quotes of HUMAN feedback from .difflab/plans/*/revisions/*.md (## Feedback), .difflab/reviews/*/REVIEW.md, and human review comments made directly on the forge (GitHub/GitLab PR/MR review threads via `gh`/`glab`) when not already in local .difflab files; exclude AI-generated review comments; or "None in this session.">

## Raw session outputs
- <speaker/role, exact output, source message location; label assistant text generated/unverified>

## Commands and results
- <command, exact relevant stdout/stderr, exit status, original event time>

## Source snippets
- <original code/document excerpt, repository, file/lines, commit/version, local changes>

## Source locations and gaps
- <links to verbatim raw harness session log and session/.difflab artifacts in ~/.diffwiki/meta/transcripts/.meta/; omitted/redacted/unavailable material>
