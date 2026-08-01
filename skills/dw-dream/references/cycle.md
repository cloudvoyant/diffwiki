# dw-dream — the maintenance cycle

## Order (each step bounded, each reversible)
1. **Signal** — `diffwiki lint -c <scope>`, recent transcripts (`diffwiki search query "" -c transcripts`), and a browse of the scope.
2. **Improve** — thin/stale/error entries → research + rewrite → `update --status draft`.
3. **Dedupe** — cluster near-duplicates (search/recall) → merge into one → deprecate the rest with a pointer.
4. **Prune** — invalid/obsolete → `--status deprecated` + pointer. Never delete.
5. **Report** — before/after lint counts + a change list for human review.

## Hard safety rules
- Allowed mutations: `article update --status draft` and `article update --status deprecated`. Nothing else.
- FORBIDDEN in dream: `article remove`, `--status published`, editing another entry's references away without a replacement.
- Deprecations must start their body with: `> Superseded by [<survivor>](<path>).`
- Respect the pass budget; surface skipped work rather than silently truncating.

## Scheduling
Run manually, or schedule with the `/schedule` skill (e.g. weekly). A scheduled run must still produce only drafts/deprecations and a report — a human reviews before promotion.
