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

## Recall context (edit diffwiki.yaml)
Append (or merge) a top-level `context` block. The reader accepts it next to either the legacy `{collection, path}` form or an extended `collections:` list:
```yaml
context:
  collections: [<this-collection>, knowledge-base, <language-collection>]
```
Verify:
```bash
diffwiki search query "" -c <this-collection>   # sanity: collection resolves
```
Only list collection NAMES that appear in `diffwiki collection list`.

## Indexing (if a plugin is installed)
```bash
diffwiki plugin list          # is a search plugin enabled?
diffwiki search index          # rebuild the index
```
