# dw-learn session — the current conversation

Capture THIS live session, then mine it. Always available — the current session is in your context, so no file access is needed.

1. **Ensure the store.** If `diffwiki collection list` lacks `transcripts`, create it hidden: `diffwiki collection create transcripts --hidden`.
2. **Identify the project.** Repo name (git toplevel basename) or cwd basename → `<project>`.
3. **Capture original material.** Read `source-capture.md`. Use the effective session-transcript template to retain exact user requests, role-labeled raw outputs, commands/results, and source snippets with message/file locators. Mark unavailable material as not captured. Redact secrets explicitly. Do not reconstruct dialogue or infer lessons, preferences, or causes. Keep the raw packet even if a user's older transcript template still requests summaries.
4. **Write the transcript** (one article) to the hidden collection:
   ```bash
   diffwiki article create "transcripts:<project>/<YYYY-MM-DD>-<shortid>" \
     -b "$(cat /tmp/dw-transcript.md)" -t "transcript,<tool>,<project>" --audience system
   ```
   It is invisible to `dw-recall` and the UI unless `showSystem` is on.
5. **Mine.** Pass the original evidence packet and its transcript location into `references/mine.md`. The resulting article's own metadata retains the relevant raw evidence.
