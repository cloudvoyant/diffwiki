---
name: dw-help
description: Explain the diffwiki CLI and the available dw-* skills. Triggers on "dw help", "what diffwiki skills are there", "how do I use diffwiki", "what can diffwiki do", "help with diffwiki", "what dw skills do I have".
---

# dw-help

Orient the user to what diffwiki can do. Cover both the CLI and the installed agent skills.

## Steps

1. **CLI version + health.** Run:
   ```bash
   diffwiki --version
   diffwiki doctor
   ```
   Report the version and any ✖ from doctor. If diffwiki is not installed, tell the user to run `/dw-install`.

2. **CLI overview.** Show the key command groups — do not list every flag, just the surface:

   | Command group | Purpose |
   |---|---|
   | `diffwiki collection` | Create, list, and manage collections |
   | `diffwiki article` | Create and update wiki entries |
   | `diffwiki search query` | Search across collections |
   | `diffwiki search index` | Re-index for a search plugin |
   | `diffwiki templates list` | List available authoring shapes |
   | `diffwiki templates init` | Seed templates to `~/.diffwiki/templates/` |
   | `diffwiki context` | Manage recall context (`context.collections`) |
   | `diffwiki lint` | Check entries against template rules |
   | `diffwiki config` | Read and write global config |
   | `diffwiki doctor` | Check plugin health |
   | `diffwiki site preview` | Live-preview the wiki site |
   | `diffwiki site export` | Build the static site |

   For full flag reference: `diffwiki <command> --help`.

3. **Available dw-* skills.** Run `diffwiki templates list` to show the current template shapes, then list the installed skills:

   | Skill | Purpose | Trigger phrases |
   |---|---|---|
   | `/dw-install` | Install the diffwiki CLI | "install diffwiki", "set up diffwiki" |
   | `/dw-init` | Guided wiki setup + recall context | "set up a wiki", "initialize diffwiki" |
   | `/dw-remember` | Capture one piece of knowledge as a draft | "remember this", "add to the wiki" |
   | `/dw-recall` | Pull relevant entries into context | "recall from the wiki", "search the wiki" |
   | `/dw-lint` | Lint entries; offer to tighten failures | "lint the wiki", "check the wiki" |
   | `/dw-learn` | Learn from a session, history, or codebase | "dw learn", "capture what we did" |
   | `/dw-dream` | Periodic improve, dedupe, and prune pass | "tidy the wiki", "improve the wiki" |
   | `/dw-help` | This skill — CLI + skill reference | "dw help", "what can diffwiki do" |

4. **Typical new-user flow.**
   ```
   /dw-install      → install the CLI
   /dw-init         → create a collection, set recall context
   /dw-remember     → capture your first entry
   /dw-recall       → search the wiki
   /dw-lint         → check entry quality
   /dw-learn        → mine a session into entries
   /dw-dream        → periodic tidy pass
   ```

5. **Answer any follow-up.** If the user asks about a specific skill or command, go deeper. For a CLI command, run `diffwiki <command> --help` and summarize. For a skill, read its SKILL.md and explain.

## Rules
- Never mutate anything — this skill is read-only.
- If diffwiki is missing, stop after step 1 and direct the user to `/dw-install`.
