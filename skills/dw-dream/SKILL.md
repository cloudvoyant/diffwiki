---
name: dw-dream
description: Periodically improve, dedupe, and prune the diffwiki. Triggers on "dw dream", "tidy the wiki", "improve the wiki", "prune the wiki", "wiki maintenance". Safe-by-default — leaves drafts/deprecations for review, never deletes, never auto-publishes. Run manually or on a schedule.
---

# dw-dream

Maintain the whole wiki in a bounded, reversible pass. Read `references/cycle.md`. Every mutation goes through the `diffwiki` CLI and is either a draft or a deprecation — never a deletion, never a publish.

## Steps

1. **Scope + budget.** Default to `-c all`; allow a single collection. Cap the pass. If `--dry-run` is passed, write all proposals to `~/.diffwiki/dream/<YYYYMMDD-HHMMSS>-proposal.md` instead of calling the CLI — print the path and stop after reporting.

2. **Gather signal.** Optionally run `/dw-learn` (capture phase) first so recent work is in the transcripts collection, then:
   ```bash
   diffwiki lint -c <scope>                      # structural debt: budgets, refs, drafts, leaks
   diffwiki search query "" -c transcripts        # recent captured transcripts (hidden collection)
   ```
   Plus browse the entries in scope.

3. **Improve.** Read `references/cycle.md` for the full improvement substeps. At a high level: load templates, run lint + STE check together, validate correctness, then rewrite.

4. **Dedupe.** Find near-duplicates with `dw-recall`/`diffwiki search query`. Merge the best content into one canonical entry (update, draft), and mark the superseded one:
   ```bash
   diffwiki article update "<collection>:<slug>" -b "$(cat /tmp/dw-dep.md)" --status deprecated
   ```
   where the body opens with a one-line pointer to the survivor.

5. **Prune.** Entries that are wrong or obsolete → set `--status deprecated` with a pointer to the replacement (or a note). NEVER `diffwiki article remove` in dream.

6. **Report.** Summarize: improved (draft), merged, deprecated, and skipped (over budget). Re-run `diffwiki lint -c <scope>` and show the before/after error counts. Nothing is published — a human promotes.

## Rules
- Reversible only: drafts + deprecations. No deletes, no publishes, no destructive edits without a pointer.
- Bounded: honor the pass budget; log what was left for next time.
- Preserve links: when deprecating/merging, keep an inline pointer so nothing dangles.
- Prefer fewer, tighter entries — dedupe aggressively, but never lose a real reference.
