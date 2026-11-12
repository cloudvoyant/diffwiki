# dw-learn history — past harness sessions and `.difflab` reviews for this project

Capture your harness's PAST sessions and `.difflab` plan/review history scoped to the current project, store their verbatim raw transcripts and review feedback in `transcripts` metadata, write the summary articles in `transcripts`, and then propose learning candidates via `references/mine.md`.

## 1. Ensure the `transcripts` store
If `diffwiki collection list` lacks `transcripts`, create it hidden:
```bash
diffwiki collection create transcripts --hidden
```

## 2. Identify the project
Repo name (`git rev-parse --show-toplevel` basename) or `pwd` basename → `<project>`.

## 3. Locate your harness's raw session transcripts and artifacts

| Harness | Store | Project match |
|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/*.jsonl` | slug = cwd, non-alnum → `-` |
| Antigravity / Gemini CLI | `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl` + `<appDataDir>/brain/<conversation-id>/` artifacts | workspace path in user_information / session logs |
| pi | `~/.pi/agent/sessions/--<path>--/*.jsonl` | slug = cwd `/`→`-`; `cwd` in the first record |
| Codex | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | `cwd` in the `SessionMeta` first line |
| Cursor | `~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb` or `~/.cursor/` | workspace folder URI |
| Goose | `~/.local/share/goose/sessions/sessions.db` | `working_dir` column (SQLite) |
| OpenCode | `~/.local/share/opencode/storage/session/<hash>/` | hash of the git project root |
| Aider | `<repo>/.aider.chat.history.md` | in-repo history file |

If the active harness isn't listed or uses a custom path, **research where that harness stores its raw session transcripts** (inspect local dot-directories, environment variables, or web-search `"<harness> session transcript file location"`) before mining.

## 4. Mine `.difflab` plans and reviews in the project
If `.difflab/` exists in the project root (often a symlink to `~/.difflab/projects/<ORG>/<repo-slug>`), follow it and read:
- **`.difflab/plans/<plan-id>/`**: `INTENT.md`, `PLAN.md`, and `revisions/*.md` (especially every `## Feedback` section recording user corrections across plan iterations).
- **`.difflab/reviews/<review-id>/`**: `REVIEW.md`, `rubric.yaml`, and human reviewer comments.

Treat human reviewer comments and plan revision feedback as primary signal for what the user values and corrects in agent behavior.

## 5. Write each transcript summary and capture verbatim metadata
Keep only sessions belonging to this project; skip sessions already captured in `transcripts:<project>/...`. For each uncaptured session:

1. **Write the structured transcript summary article:**
   ```bash
   diffwiki article create "transcripts:<project>/<YYYY-MM-DD>-<shortid>" \
     -b "$(cat /tmp/dw-transcript.md)" -t "transcript,<tool>,<project>" --audience system
   ```
   Include the summary of any associated `.difflab` plan/review feedback in the transcript article.
2. **Capture the verbatim raw session and `.difflab` artifacts in `transcripts` metadata:**
   ```bash
   diffwiki meta new "transcripts:<project>/<YYYY-MM-DD>-<shortid>.md" --template history --json
   ```
   Copy/attach the verbatim raw session log, session artifacts, and `.difflab` plan/review feedback into `~/.diffwiki/meta/transcripts/.meta/attachments/<record-id>/` (redacting secrets), fill the returned history record in `~/.diffwiki/meta/transcripts/.meta/records/<record-id>.md`, and run:
   ```bash
   diffwiki meta reindex transcripts --json
   ```

## 6. Propose learning candidates (`references/mine.md`)
Read this project's captured transcripts and metadata records, then run `references/mine.md` to propose candidates (showing title, nested target collection path, shape, and `CREATE`/`UPDATE` action) and wait for user approval unless `--yes` / `--auto` or prior permission was given.
