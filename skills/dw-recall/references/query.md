# dw-recall — filtering + output contract

## Collection filter
- Source order: explicit caller override → repo `diffwiki.yaml` `context.collections` → none (all collections).
- The CLI accepts a comma-separated set: `-c my-repo,knowledge-base,typescript`.
- Names must match `diffwiki collection list`; an unknown name errors — drop it and retry.

## Engine
- The engine is whatever `diffwiki` resolves (config `defaultSearch`, else first plugin, else native BM25). Pass `-t hybrid|semantic|keyword` only if the caller asks and the engine supports it.
- If the engine errors, `diffwiki` falls back to native and prints a `⚠` line; report the fallback but still return hits.

## Output contract (agent-callable)
Compact list form:
```
<title> (<collection>) — <path>
  <snippet>
```
Body form (top N), each block:
```
### <title> — <collection>/<slug>
<body with frontmatter stripped>
```
Keep total output tight; recall exists to fill context efficiently, not to dump the wiki.
