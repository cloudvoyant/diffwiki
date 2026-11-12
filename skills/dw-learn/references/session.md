# dw-learn session — capture the live session, raw harness logs, and Difflab reviews

Capture THIS live session (both the structured summary article in `transcripts` and the verbatim raw session + review artifacts in `transcripts` metadata), then mine general learnings via `references/mine.md`.

## 1. Ensure the `transcripts` store
If `diffwiki collection list` lacks `transcripts`, create it hidden:
```bash
diffwiki collection create transcripts --hidden
```

## 2. Identify the project and active harness
- Project name: repo name (`git rev-parse --show-toplevel` basename) or `pwd` basename → `<project>`.
- Locate the **verbatim raw session file(s)** and any **session artifacts** created by the agent in the current harness:

| Harness | Verbatim Session & Artifact Locations |
|---|---|
| Claude Code | `~/.claude/projects/<slug>/<session-id>.jsonl` (slug = cwd with non-alnum → `-`) |
| Antigravity / Gemini CLI | `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl` (and `transcript.jsonl`), plus session artifacts in `<appDataDir>/brain/<conversation-id>/` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (match `cwd` in `SessionMeta`) |
| Cursor | `~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb` or `~/.cursor/` composer/agent transcripts |
| OpenCode | `~/.local/share/opencode/storage/session/<hash>/` |
| Goose | `~/.local/share/goose/sessions/sessions.db` (`working_dir` column) |
| pi | `~/.pi/agent/sessions/--<path>--/*.jsonl` |
| Aider | `.aider.chat.history.md` in the project root |

If the user is running a different or unknown harness, **research where that harness stores its raw session transcripts** (inspect environment variables, dot-directories, or run a web/file search for `<harness> session transcript storage location`) so the literal raw session can be captured verbatim.

## 3. Mine `.difflab` plans/reviews and direct forge human review comments
1. **Local `.difflab/` store:** Check whether the project has a `.difflab/` directory (frequently a symlink created by `difflab-init` pointing to `~/.difflab/projects/<ORG>/<repo-slug>`). Follow the symlink and inspect:
   - **`.difflab/plans/<plan-id>/`**: `INTENT.md`, `PLAN.md`, and `revisions/*.md` (specifically every `## Feedback` section recording what the user asked to change or refine across plan iterations).
   - **`.difflab/reviews/<review-id>/`**: `REVIEW.md` and `rubric.yaml`.
2. **Direct forge PR/MR review comments:** Query the forge directly (e.g. via `gh pr view` / `gh api repos/<owner>/<repo>/pulls/<pr>/comments` or `glab`) for review comments on the current branch's PR/MR that are not already recorded in local `.difflab` files.
3. **Exclude AI review comments:** Keep only **human** reviewer comments and feedback; filter out AI-generated review comments (e.g. bot accounts, Copilot reviews, or comments carrying `> Generated via` model footers).

**Why this matters:** Comments and corrections made by human reviewers (in `.difflab/reviews/`, `.difflab/plans/*/revisions/*.md`, directly on the forge PR/MR, or live in the session) are the highest-signal evidence of what the user values and what they are correcting in the agent's behavior.

## 4. Write the session transcript summary article
Use the `session-transcript` template (`diffwiki templates list --json`) to write the structured session summary article in `transcripts`, including a dedicated summary of `.difflab` plan/review feedback and human reviewer corrections:
```bash
diffwiki article create "transcripts:<project>/<YYYY-MM-DD>-<shortid>" \
  -b "$(cat /tmp/dw-transcript.md)" -t "transcript,<tool>,<project>" --audience system
```
Note the exact relative article path returned (e.g. `<project>/<YYYY-MM-DD>-<shortid>.md`).

## 5. Capture verbatim raw session, artifacts, and `.difflab` feedback in `transcripts` metadata
Read `references/source-capture.md`. Allocate a `history` metadata record attached to the transcript article:
```bash
diffwiki meta new "transcripts:<project>/<YYYY-MM-DD>-<shortid>.md" --template history --json
```
1. **Copy or attach the literal raw harness session and session artifacts** into `~/.diffwiki/meta/transcripts/.meta/attachments/<record-id>/` (redacting any secrets/tokens first) and link them from the metadata record.
2. **Fill the returned metadata record** (`~/.diffwiki/meta/transcripts/.meta/records/<record-id>.md`) with:
   - Exact verbatim user requests and stated rationale from the session,
   - Verbatim human reviewer comments and `.difflab/plans/*/revisions/*.md` `## Feedback` + `.difflab/reviews/*/REVIEW.md` excerpts,
   - Key raw tool/command outputs and source snippets with file/line locators, and
   - Relative links to the attached raw harness session file(s) and session artifacts.
3. Reindex the `transcripts` metadata store:
   ```bash
   diffwiki meta reindex transcripts --json
   ```

## 6. Propose general learning candidates (`references/mine.md`)
Pass the captured evidence into `references/mine.md`.
- **Focus on GENERAL, reusable learnings** in `session` mode (language/framework patterns, library usage, tooling recipes, and general engineering/agent lessons from human review feedback) — do **not** propose repo-specific architecture or implementation details of the current repo.
- Present the candidate list upfront (showing title, nested target collection path, shape, and `CREATE`/`UPDATE` action) and wait for user selection unless `--yes` / `--auto` or prior auto-draft permission was given.
