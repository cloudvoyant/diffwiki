# dw-init — exact commands

## In-repo collection
```bash
# name defaults to the repo name; path defaults to wiki/
diffwiki collection init -c <name> -p <path>
```
This creates `<repo>/<path>/` and writes `<repo>/diffwiki.yaml` in the legacy single-collection form:
```yaml
collection: <name>
path: <path>
```

## Global collection
```bash
diffwiki collection create <name>   # → ~/.diffwiki/collections/<name>
```

## Recall context (via the CLI — never hand-edit diffwiki.yaml)
Set the recall context with the `context` command; it edits `diffwiki.yaml` in place, preserving your other keys and comments (and creating the file if needed):
```bash
diffwiki context set <this-collection>,knowledge-base,<language-collection>
diffwiki context show      # verify
```
Use only collection NAMES that appear in `diffwiki collection list` (the command warns on unknown names). `context add <names>` / `context remove <names>` adjust the list incrementally.

## Indexing (if a plugin is installed)
```bash
diffwiki plugin list          # is a search plugin enabled?
diffwiki search index          # rebuild the index
```
