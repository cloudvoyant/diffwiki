---
name: dw-forget
description: Remove one or more diffwiki articles from the default collection or a specific collection. Triggers on "dw forget", "forget this", "remove from the wiki", "delete article", "remove wiki entry". Searches first when given a topic or title, confirms before deleting, and mutates only via the diffwiki CLI.
---

# dw-forget

Remove obsolete, duplicate, or unwanted articles from the default collection or a named collection via `diffwiki article remove`.

## Inputs
- Target article(s): a `<slug>`, `<collection>:<slug>`, `<collection>/<subpath>:<slug>`, or a natural-language topic/title query.
- Optional `-c, --collection <name>`: scope removal to a specific collection (or nested collection path).
- Optional `--yes`: skip confirmation when the target resolves to an exact single article.

## Steps

1. **Resolve the target collection.**
   - If the user passed `<collection>:<slug>`, `<collection>/<subpath>:<slug>`, or `-c <collection>`, use that collection.
   - Otherwise check `diffwiki config get defaultCollection`. If unset and the current directory has a repo collection (`diffwiki.yaml`), use that collection; if still unset, ask which collection to remove from (or search across all collections in Step 2).

2. **Locate matching article(s).**
   - If the user gave a topic, title, or partial name, search first:
     ```bash
     diffwiki search query "<query>" -c <collection>
     ```
     (Omit `-c` if no collection was specified and no default collection is configured.)
   - Show the matching articles with their `collection:slug`, title, and path.
   - If no article matches, report that nothing matched and stop.

3. **Confirm before deleting.**
   - Unless `--yes` was passed and there is an exact single match, show the exact `collection:slug` (or default-collection `slug`) to be removed and ask the user to confirm.
   - If multiple articles matched, ask the user to pick which ones to remove.

4. **Remove via the CLI.**
   ```bash
   # Specific collection or nested subpath:
   diffwiki article remove "<collection>:<slug>"
   diffwiki article remove "<collection>/<subpath>:<slug>"

   # Configured defaultCollection:
   diffwiki article remove "<slug>"
   ```

5. **Report.** Print the removed file path(s). Note that any raw source records under `~/.diffwiki/meta/<collection>/` remain intact unless deleted manually.

## Rules
- Always mutate through `diffwiki article remove` — never `rm` collection markdown files directly.
- Never delete an whole collection when asked to forget an article.
- Never delete `system`-audience transcripts unless the user explicitly names `transcripts:<slug>`.
