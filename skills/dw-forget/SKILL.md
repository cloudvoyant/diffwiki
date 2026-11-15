---
name: dw-forget
description: "Remove diffwiki articles or collections through the diffwiki CLI. Triggers on \"dw forget\", \"forget this\", \"remove from the wiki\", \"delete article\", \"remove wiki entry\", \"remove collection\", and \"delete collection\". Searches before deleting articles, confirms before mutating, and asks before passing --force on non-empty global collections."
---

# dw-forget

Remove obsolete articles with `diffwiki article remove`, or remove a collection with `diffwiki collection remove` when the user asks to delete a collection.

## Inputs

- Article target: `<slug>`, `<collection>:<slug>`, `<collection>/<subpath>:<slug>`, or a topic/title search query.
- Collection target: an explicit request to remove collection `<name>`.
- Optional `-c, --collection <name>`: scope article search and removal to a named collection.
- Optional `--yes`: skip confirmation when an article request matches one exact slug, or when removing an empty collection.

## Article Removal Steps

1. Resolve the target collection:
   - If the user passed `<collection>:<slug>`, `<collection>/<subpath>:<slug>`, or `-c <collection>`, use that collection.
   - Otherwise read `diffwiki config get defaultCollection`. If unset and the current directory has `diffwiki.yaml`, use that repo collection.

2. Locate matching articles:
   - If the user gave a topic or partial title, search first:
     ```bash
     diffwiki search query "<query>" -c <collection>
     ```
   - Show matching `collection:slug` entries, titles, and paths. If nothing matches, report that and stop.

3. Confirm and remove:
   - Unless `--yes` was passed for a single exact match, ask the user to confirm the target `collection:slug`.
   - Run the CLI:
     ```bash
     diffwiki article remove "<collection>:<slug>"
     diffwiki article remove "<slug>"
     ```
   - Report the removed path. Note that `~/.diffwiki/meta/<collection>/` stays intact.

## Collection Removal Steps

1. Inspect the collection with `diffwiki collection list` and confirm with the user unless `--yes` was passed for an empty collection.
2. Run collection removal without `--force` first:
   ```bash
   diffwiki collection remove "<name>" --json
   ```
3. If `CollectionNotEmptyError` reports remaining articles in a global collection, tell the user how many articles remain and ask for explicit confirmation before running:
   ```bash
   diffwiki collection remove "<name>" --force --json
   ```
4. Report the result. `global` collections delete `~/.diffwiki/collections/<name>` and clear matching `defaultCollection`. `repo` and `external` collections unregister from `~/.diffwiki/registry.json` and keep repository files intact. `~/.diffwiki/meta/<name>/` stays intact.

## Rules

- Mutate only through `diffwiki article remove` and `diffwiki collection remove`. Never run `rm` on collection files directly.
- Never remove a collection when the user asked to forget an article.
- Never pass `--force` to `diffwiki collection remove` without asking the user after `CollectionNotEmptyError`.
- Never delete `system`-audience transcripts unless the user names `transcripts:<slug>` or collection `transcripts`.
