# dw-remember — template resolution + shape choice

## Discover shapes from the CLI (don't hard-code them)

The available shapes, their purpose, and their token budget come from the CLI — each is read from that template's own frontmatter, so the set is whatever templates exist (bundled + any the user added):

```bash
diffwiki templates list          # shape · purpose · [budget]
diffwiki templates list --json   # machine-readable: [{shape, purpose, budget, file}]
```

Pick the shape whose **purpose** best matches the knowledge, and stay within its **budget** (`diffwiki lint` enforces it). If `templates list` is empty, run `diffwiki templates init` (or `/dw-init`).

## Resolve the template file

Templates live at `~/.diffwiki/templates/<shape>-template.md` (a user copy overrides the bundled default). Pass the chosen file's path to `dw-author`. Each template's HTML comment section contains the authoring rules — `dw-author` reads these before writing.

## Customizing / adding a shape

Drop a `*-template.md` into `~/.diffwiki/templates/` with `shape:`, `purpose:`, and (optionally) `budget: [min, max]` frontmatter. It becomes discoverable via `diffwiki templates list` automatically — no skill changes needed.
