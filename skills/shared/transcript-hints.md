# Where agents store transcripts (hints for historical capture)

dw-learn asks the running agent to introspect its OWN sessions. The current session is always available from the agent's context. For HISTORICAL sessions scoped to the current project, the agent locates its tool's transcript store below, filters to this project, and normalizes each into the session-transcript template. If your tool isn't listed, web-search "<tool> session/transcript file location" and use that.

| Tool | Store | Format | project ↔ transcript |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/` (`$CLAUDE_CONFIG_DIR` overrides) | JSONL | slug = cwd, every non-alphanumeric → `-` |
| pi | `~/.pi/agent/sessions/--<path>--/` (`PI_CODING_AGENT_SESSION_DIR`) | JSONL | slug = cwd `/`→`-`; also `cwd` in the first `session` record |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`CODEX_HOME`) | JSONL | cwd in the `SessionMeta` first line; SQLite cwd index too |
| Goose | `~/.local/share/goose/sessions/sessions.db` (legacy `*.jsonl`) | SQLite | `working_dir` column |
| OpenCode | `~/.local/share/opencode/storage/session/<projectHash>/` (`OPENCODE_DATA_DIR`) | JSON (+SQLite) | dir = hash of the git project root |

Only capture transcripts whose recorded working directory is (under) the current project. Extract: what was worked on, issues/learnings, decisions/patterns, key tool actions, open threads. The diffwiki CLI never parses these files — you do, then write via `diffwiki article create`.
