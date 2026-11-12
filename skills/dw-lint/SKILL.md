---
name: dw-lint
description: Lint diffwiki entries against the template rules. Triggers on "dw lint", "lint the wiki", "check the wiki", "lint this collection". Defaults to the current collection; -c current|all|<names> or natural language ("lint everything") selects scope. Offers to tighten failures via dw-reviewer.
---

# dw-lint

Run `diffwiki lint` and, on failures, offer to fix using `dw-reviewer` and `references/technical-writing-guide.md`.

## Steps

1. **Resolve scope.** From the flag `--collections|-c` or natural language:
   - `current` (default) — the cwd's collection.
   - `all` / "everything" / "the whole wiki" — every collection.
   - one or more names / "the typescript collection" → comma-separated list.

2. **Lint.**
   ```bash
   diffwiki lint -c <current|all|a,b,c>
   ```
   It prints `✓`/`!`/`✖` per file and a summary; exit is non-zero when any ✖ exists.

3. **Summarize.** Group findings by file. Lead with ✖ errors (must fix), then ! warnings. If everything is ✓, say so and stop.

4. **Offer to fix (only if there are ✖).** Ask whether to tighten now. If yes, read `references/technical-writing-guide.md` and, for each file with an error, dispatch the `dw-reviewer` agent with the file path, its findings, and `references/technical-writing-guide.md` (which invokes `/simple-english`, enforces the five writing rules, and requires a second pass to shorten further). Take the tightened body and apply it:
   ```bash
   diffwiki article update "<collection>:<slug>" -b "$(cat /tmp/dw-fix.md)" --status draft
   ```
   Re-run `diffwiki lint` on those files to confirm they are clean. Leave `status` as-is (reviewer output is still a draft until a human promotes it).

## Rules
- Reporting is read-only; fixing is opt-in and always leaves entries as drafts.
- All tightened prose must follow `references/technical-writing-guide.md` (`/simple-english`, terse artifacts, no walls of text, no inline file/class inventories, diagrams where appropriate, and a second shortening pass).
- Never auto-promote to `published`.
- For `all`, warn if the run is large and offer to scope down first.
