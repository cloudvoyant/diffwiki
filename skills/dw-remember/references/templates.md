# dw-remember — template resolution + shape choice

## Resolve the template file
Templates live at `~/.diffwiki/templates/<shape>-template.md`, seeded from the bundled defaults by `/dw-install` (and `/dw-init`); users may drop their own there to override. If the dir is empty, run `/dw-install`.

Shapes → filenames:
- `recipe` → `recipe-template.md`
- `recipe-steps` → `recipe-with-steps-template.md`
- `guide` → `guide-template.md`
- `system-design` → `system-design-template.md`
- `component-design` → `component-design-template.md`

## Choose the shape (budgets are what `diffwiki lint` enforces)
- One contained pattern + one canonical example → **recipe** (300–1000 tok).
- An ordered sequence (do X, then Y, then Z) → **recipe-steps** (500–1500).
- Ties several patterns together, narrative → **guide** (1500–5000).
- A whole system's architecture → **system-design** (2000–6000).
- One component's contract + internals → **component-design** (1000–3000).

Full rules: `~/.diffwiki/templates/taxonomy.md`.

## User templates
Users may add their own shapes under `~/.diffwiki/templates/`. If a user template is chosen, pass ITS path to `dw-author`; the author still strips guidance comments and placeholders and obeys the References + brevity rules.
