# dw-learn session — the current conversation

Capture THIS live session, then mine it. Always available — the current session is in your context, so no file access is needed.

1. **Ensure the store.** If `diffwiki collection list` lacks `transcripts`, create it hidden: `diffwiki collection create transcripts --hidden`.
2. **Identify the project.** Repo name (git toplevel basename) or cwd basename → `<project>`.
3. **Introspect.** Summarize your own conversation into the `~/.diffwiki/templates/session-transcript-template.md` shape: Worked on / Issues & learnings / Decisions & patterns / Key tool actions / Open threads. Terse and factual. Redact any secrets seen in tool output.
4. **Write the transcript** (one article) to the hidden collection:
   ```bash
   diffwiki article create "transcripts:<project>/<YYYY-MM-DD>-<shortid>" \
     -b "$(cat /tmp/dw-transcript.md)" -t "transcript,<tool>,<project>" --audience system
   ```
   It is invisible to `dw-recall` and the UI unless `showSystem` is on.
5. **Mine.** Read the transcript you just wrote and run `references/mine.md`.
