---
name: dw-dream
description: Periodically improve, dedupe, and prune the diffwiki. Triggers on "dw dream", "tidy the wiki", "improve the wiki", "prune the wiki", "wiki maintenance". Safe-by-default — leaves drafts/deprecations for review, never deletes, never auto-publishes. Run manually or on a schedule.
---

# dw-dream

Maintain the whole wiki in a bounded pass. Read `references/cycle.md` and `references/source-capture.md`. Article writes use the CLI and remain drafts/deprecations. Source records are allocated through the CLI and filled as Markdown. Never delete articles or metadata, and never publish automatically.

## Steps

1. **Scope + budget.** Default to `-c all`; allow a single collection. Cap the pass (e.g. up to N improvements + N merges); report anything skipped. If `--dry-run` is passed, write all proposals to `~/.diffwiki/dream/<YYYYMMDD-HHMMSS>-proposal.md` instead of calling the CLI — print the path and stop after reporting.

2. **Gather signal.** Outside dry-run mode, optionally run `/dw-learn` first. Read the page/collection metadata and its original evidence, then:
   ```bash
   diffwiki lint -c <scope>                      # structural debt: budgets, refs, drafts, leaks
   diffwiki search query "" -c transcripts        # recent captured transcripts (hidden collection)
   ```
   Plus browse the entries in scope.

3. **Improve.** Read `references/cycle.md`. Use original source snippets, user requests, and observed validation output. Do not turn assistant summaries into evidence or infer preferences and causes. Retain the raw packet before rewriting.

4. **Dedupe.** Find near-duplicates with `dw-recall`/`diffwiki search query`. Merge the best content into one canonical entry (update, draft), and mark the superseded one:
   ```bash
   diffwiki article update "<collection>:<slug>" -b "$(cat /tmp/dw-dep.md)" --status deprecated
   ```
   where the body opens with a one-line pointer to the survivor.

5. **Prune.** Entries that are wrong or obsolete → set `--status deprecated` with a pointer to the replacement (or a note). NEVER `diffwiki article remove` in dream.

6. **Record and report.** For each actual change, preserve newly used raw sources and allocate a `dream-learning` record for the affected page. Fill its raw requests, outputs, snippets, source links, and exact change/result. Link both original source histories when merging. Reindex and report article/record paths, partial failures, and skipped work. No learning record is needed for a no-op check. A dry run writes only its proposal, including the proposed record content.

## Rules
- Reversible only: drafts + deprecations. No deletes, no publishes, no destructive edits without a pointer.
- Bounded: honor the pass budget; log what was left for next time.
- Preserve links: when deprecating/merging, keep an inline pointer so nothing dangles.
- Prefer fewer, tighter entries — dedupe aggressively, but never lose a real reference.
