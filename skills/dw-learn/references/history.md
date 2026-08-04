# dw-learn history — past sessions for this project

Capture your tool's PAST sessions scoped to the current project, then mine them. You (the running agent) know your own tool best — diffwiki never parses transcript files; you do, then write via the CLI.

1. **Ensure the store.** If `diffwiki collection list` lacks `transcripts`, create it hidden: `diffwiki collection create transcripts --hidden`.
2. **Identify the project.** Repo name or cwd basename → `<project>`.
3. **Locate your tool's transcripts:**

   | Tool | Store | project match |
   |---|---|---|
   | Claude Code | `~/.claude/projects/<slug>/*.jsonl` | slug = cwd, non-alnum → `-` |
   | pi | `~/.pi/agent/sessions/--<path>--/*.jsonl` | slug = cwd `/`→`-`; `cwd` in the first record |
   | Codex | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | `cwd` in the SessionMeta first line |
   | Goose | `~/.local/share/goose/sessions/sessions.db` | `working_dir` column (SQLite) |
   | OpenCode | `~/.local/share/opencode/storage/session/<hash>/` | hash of the git project root |

   If your tool isn't listed, web-search "<tool> session transcript file location" and use that.
4. **Filter + normalize.** Keep only sessions whose working directory is (under) this project. For each, extract the five `session-transcript` sections (Worked on / Issues & learnings / Decisions & patterns / Key tool actions / Open threads). Skip sessions already captured (a matching `transcripts/<project>/…` entry exists). Redact secrets. Do not capture other projects' sessions.
5. **Write each transcript:**
   ```bash
   diffwiki article create "transcripts:<project>/<YYYY-MM-DD>-<shortid>" \
     -b "$(cat /tmp/dw-transcript.md)" -t "transcript,<tool>,<project>" --audience system
   ```
6. **Mine.** Read this project's transcripts (`diffwiki search query "" -c transcripts`, filtered to `<project>` entries) and run `references/mine.md`.
