# dw-remember — template resolution + shape choice

## Discover shapes from the CLI (don't hard-code them)

The available shapes, their purpose, and their token budget come from the CLI — each is read from that template's own frontmatter, so the set is whatever templates exist (bundled + any the user added):

```bash
diffwiki templates list          # shape · purpose · [budget]
diffwiki templates list --json   # [{shape, purpose, budget, file, path, category}]
```

Pick the shape whose **purpose** best matches the knowledge, and stay within its **budget** (`diffwiki lint` enforces it). If `templates list` is empty, run `diffwiki templates init` (or `/dw-init`).

## Resolve the template file

Use the effective `path` from `diffwiki templates list --json`. A file under `~/.diffwiki/templates` overrides the bundled default. Pass that path to `dw-author`; it reads any template guidance before writing. `DIFFWIKI_HOME` changes the template root.

The default list contains article templates. Source templates use `diffwiki templates list --category meta --json` and the separate workflow in `source-capture.md`. They are not article shapes and have no article token budget.

## Customizing / adding a shape

Drop a `*-template.md` into `~/.diffwiki/templates/` with `shape:`, `purpose:`, and (optionally) `budget: [min, max]` frontmatter. It becomes discoverable via `diffwiki templates list` automatically — no skill changes needed.
