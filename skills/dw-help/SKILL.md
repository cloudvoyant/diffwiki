---
name: dw-help
description: Explain the diffwiki CLI and the available dw-* skills. Triggers on "dw help", "what diffwiki skills are there", "how do I use diffwiki", "what can diffwiki do", "help with diffwiki", "what dw skills do I have".
---

# dw-help

Orient the user to what diffwiki can do. Cover both the CLI and the installed agent skills.

## Steps

1. Check CLI version and health:
   ```bash
   diffwiki --version
   diffwiki doctor
   ```
   Report the version and any `✖` diagnostics from `doctor`. If `diffwiki` is not installed, direct the user to `/dw-install`.

2. Show the core CLI command surface:

   | Command group | Purpose |
   |---|---|
   | `diffwiki collection` | Create, list, add, init, edit, and remove collections |
   | `diffwiki link <repo>` | Link `~/.diffwiki` to a GitHub repository (`<owner>/<repo>` or URL) |
   | `diffwiki pull` | Fetch `origin/main` and rebase `user/<username>` |
   | `diffwiki push` | Push non-draft updates to `origin/user/<username>` and create or join an open PR |
   | `diffwiki article` | Create, update, edit, and remove wiki entries (`[collection[/subpath]:]slug`) |
   | `diffwiki search query` | Search across collections |
   | `diffwiki search index` | Rebuild the search plugin index |
   | `diffwiki templates list` | List available authoring and metadata shapes |
   | `diffwiki templates init` | Seed templates to `~/.diffwiki/templates/` |
   | `diffwiki meta` | Capture and reindex raw source records beside collections |
   | `diffwiki context` | Manage recall context (`context.collections`) |
   | `diffwiki lint` | Check entries against template rules |
   | `diffwiki config` | Read and write global configuration |
   | `diffwiki doctor` | Check configuration and plugin health |
   | `diffwiki site preview` | Preview the repo wiki site |
   | `diffwiki site export` | Build the static site |

   For full flag details, run `diffwiki <command> --help`.

3. List the installed `dw-*` skills:

   | Skill | Purpose | Trigger phrases |
   |---|---|---|
   | `/dw-install` | Install the diffwiki CLI | "install diffwiki", "set up diffwiki" |
   | `/dw-init` | Guided wiki setup and recall context | "set up a wiki", "initialize diffwiki" |
   | `/dw-remember` | Capture knowledge as a draft in a best-fit collection | "remember this", "add to the wiki" |
   | `/dw-forget` | Remove articles or collections through the CLI | "dw forget", "forget this", "remove collection" |
   | `/dw-recall` | Fetch relevant entries into context | "recall from the wiki", "search the wiki" |
   | `/dw-sync` | Pull `origin/main`, push non-drafts, and join or open a PR | "dw sync", "diffwiki sync", "sync wiki" |
   | `/dw-lint` | Lint entries and offer fixes | "lint the wiki", "check the wiki" |
   | `/dw-learn` | Propose and draft learnings from a session, history, or repo | "dw learn", "capture what we did" |
   | `/dw-dream` | Periodic improve, dedupe, and prune pass | "tidy the wiki", "improve the wiki" |
   | `/dw-help` | CLI and skill reference | "dw help", "what can diffwiki do" |

4. Show the typical workflow:
   ```text
   /dw-install      -> install the CLI
   /dw-init         -> create a collection and set recall context
   /dw-remember     -> capture an entry (for example react/tanstack:Query Keys)
   /dw-recall       -> search the wiki
   /dw-lint         -> check entry quality
   /dw-learn        -> propose and draft learnings from a session
   /dw-sync         -> pull upstream changes and push non-drafts to your PR
   /dw-forget       -> remove obsolete articles or empty collections
   /dw-dream        -> periodic tidy pass
   ```

5. Answer follow-up questions. For a CLI command, run `diffwiki <command> --help` and summarize. For a skill, read its `SKILL.md` and explain.

## Rules

- Never mutate files or configuration. This skill is read-only.
- If `diffwiki` is missing, stop after Step 1 and direct the user to `/dw-install`.
