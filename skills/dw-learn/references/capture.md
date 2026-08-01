# dw-learn — capturing your own transcripts

You (the running agent) know your own tool best. diffwiki never parses transcript files — you do, then write via the CLI.

## Current session
Always available: summarize your own conversation directly into the `session-transcript` shape. No file access needed.

## Historical sessions (project-scoped)
Locate your tool's transcript store (this table mirrors `shared/transcript-hints.md`):

| Tool | Store | project match |
|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/*.jsonl` | slug = cwd, non-alnum → `-` |
| pi | `~/.pi/agent/sessions/--<path>--/*.jsonl` | slug = cwd `/`→`-`; `cwd` in header |
| Codex | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | `cwd` in SessionMeta first line |
| Goose | `~/.local/share/goose/sessions/sessions.db` | `working_dir` column (SQLite) |
| OpenCode | `~/.local/share/opencode/storage/session/<hash>/` | hash of git project root |

If your tool isn't listed, web-search "<tool> session transcript file location" and use that.

Keep only transcripts whose working directory is (under) the current project. For each, extract Worked on / Issues & learnings / Decisions & patterns / Key tool actions / Open threads, and write it (see SKILL step 5). De-dupe against already-captured `transcripts/<project>/…` entries.

## Scope + safety
- One transcript article per session. Title `<project>/<date>-<shortid>`; tags `[transcript, <tool>, <project>]`; `--audience system`.
- Do not capture other projects' sessions. Do not include secrets/tokens seen in tool output — redact.
