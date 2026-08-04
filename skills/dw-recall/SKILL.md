---
name: dw-recall
description: Recall relevant diffwiki entries for a query. Triggers on "dw recall", "recall from the wiki", "search the wiki", "what does the wiki say about". Usable by a human or by another agent to fetch grounding snippets. Honors the repo context.collections filter.
---

# dw-recall

Return the tightest relevant wiki entries for a query. Read-only. Never mutate.

## Steps

1. **Build the collection filter.** If the repo has a `diffwiki.yaml` with `context.collections`, use them: join as `a,b,c`. Otherwise search all collections (no `-c`). A caller may override with an explicit collection set.

2. **Query — and expand it yourself.** The semantic engine (qmd) has a tiny
   built-in query-expansion model; **you are a far better expander**, so do it
   for it. Pass typed variants and let the engine just retrieve + rerank:
   ```bash
   diffwiki search query "<the user's intent, verbatim>" -c "<a,b,c>" \
     --lex "<exact keywords/identifiers — phrases in quotes, -exclude noise>" \
     --vec "<a natural-language question capturing the intent>" \
     --hyde "<1-2 sentences that look like the ideal answer passage>"
   ```
   - The positional term is the **intent** (used for ranking); the flags are the
     actual sub-queries. All flags are repeatable and optional.
   - **Always expand** for conceptual/vague/short queries. For a known exact
     term/identifier, a plain `--lex` (or no flags at all) is fine.
   - Craft `--lex` tightly: real identifiers and quoted phrases, and `-exclude`
     terms to suppress obvious false positives (e.g. `-helix -vim` when the topic
     isn't editors). A sloppy keyword like `command` will pull in unrelated docs.
   - Omit the flags entirely for a plain search:
   ```bash
   diffwiki search query "<terms>"                       # unfiltered, no expansion
   ```
   Output columns are `score  collection  title  path  [snippet]`.

   > Note: the wiki's browser search UI has no LLM, so it can't do this — its
   > results for short queries are weaker than agent-driven recall. See
   > `docs/search.md`.

3. **Return results.**
   - Default: a compact ranked list — `title (collection) — path` for the top 5–8 hits, each with its one-line snippet if present.
   - If the caller asked for content (or is an agent needing grounding), read and return the BODY of the top 1–3 entries (strip frontmatter), clearly delimited with their source path.
   - If zero hits: say so and suggest broadening terms or running `diffwiki search index`.

## Rules
- Quiet by default: when called by another agent, return ONLY the ranked list or the requested bodies — no chatter.
- Prefer `published` entries; if a top hit is `status: draft`, mark it `(draft)` so callers weigh it accordingly.
- The hidden `transcripts`/system collections are excluded automatically by the CLI — never surface them here (don't reach for `showSystem`).
- Do not re-rank by hand beyond what the engine returns; just format.
- Never write, promote, or delete anything.
