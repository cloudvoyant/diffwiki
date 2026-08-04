# dw-dream — the maintenance cycle

## Order (each step bounded, each reversible)
1. **Signal** — `diffwiki lint -c <scope>`, recent transcripts (`diffwiki search query "" -c transcripts`), and a browse of the scope.
2. **Improve** — thin/stale/error entries → research + rewrite → `update --status draft`.

### Improve substeps

For each entry flagged for improvement:

2a. **Load templates.** Run `diffwiki templates list` and read the template file for the entry's shape at `~/.diffwiki/templates/<shape>-template.md`. This gives the current authoring rules — do not rely on memory.

2b. **STE + lint check.** Dispatch `dw-reviewer` with the entry body, the lint findings (from Step 2), and the `references/technical-writing-guide.md` checklist. The reviewer checks template conformance AND Simple Technical English in one pass.

2c. **Correctness validation.** Before dispatching `dw-author`, check that the entry's code examples, CLI commands, and referenced files/APIs are still valid:
   - Run any CLI command shown in the entry that is read-only and safe; if it errors, flag it. Skip commands that modify state or could cause side effects — flag them for manual review instead.
   - Check any file paths referenced still exist.
   - Flag anything that looks stale or broken — note it in the proposal rather than silently rewriting.

2d. **Rewrite (or propose).** Dispatch `dw-author` with the template, research, and correctness findings. Apply via `diffwiki article update … --status draft`. In `--dry-run` mode, write the proposed body to the proposal file instead.

3. **Dedupe** — cluster near-duplicates (search/recall) → merge into one → deprecate the rest with a pointer.
4. **Prune** — invalid/obsolete → `--status deprecated` + pointer. Never delete.
5. **Report** — before/after lint counts + a change list for human review.

## Hard safety rules
- Allowed mutations: `article update --status draft` and `article update --status deprecated`. Nothing else.
- FORBIDDEN in dream: `article remove`, `--status published`, editing another entry's references away without a replacement.
- Deprecations must start their body with: `> Superseded by [<survivor>](<path>).`
- Respect the pass budget; surface skipped work rather than silently truncating.

## --dry-run mode

When `--dry-run` is passed:
1. Collect all proposed changes (improvements, dedupes, deprecations) but do not call `diffwiki article update` or set any `--status`.
2. Write the full proposal to `~/.diffwiki/dream/$(date +%Y%m%d-%H%M%S)-proposal.md`.
3. Format the proposal as a markdown document: one section per entry, showing the current body, the proposed body, and the reason.
4. Print: `✓ Dry-run complete. Review your proposals at: ~/.diffwiki/dream/<filename>.md`
5. Stop. No mutations.

## Scheduling
Run manually, or schedule with the `/schedule` skill (e.g. weekly). A scheduled run must still produce only drafts/deprecations and a report — a human reviews before promotion.
