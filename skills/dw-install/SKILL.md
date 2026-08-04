---
name: dw-install
description: Install the diffwiki CLI. Triggers on "dw install", "set up diffwiki", "install diffwiki", or when a dw-* skill reports diffwiki is missing. Installs the diffwiki CLI if absent and offers to initialize a wiki.
---

# dw-install

Ensure the `diffwiki` CLI is present. Run this when a `dw-*` skill can't find `diffwiki`. This skill's only job is the CLI — templates and wiki setup belong to `/dw-init`.

## Steps

1. **Detect.** `diffwiki --version`. If it prints a version, skip to step 3.
2. **Install the CLI.** `npm i -g diffwiki` (fallback: `pnpm add -g diffwiki`). Re-run `diffwiki --version`. If it still fails, tell the user to install Node ≥ 20 / npm and stop.
3. **Health check.** `diffwiki doctor`; report any ✖.
4. **Offer setup.** Suggest `/dw-init` to create a wiki and seed the authoring templates (`~/.diffwiki/templates`, via `diffwiki templates init`).

## Rules

- Install ONLY the global `diffwiki` package. Templates ship with the CLI and are seeded by `/dw-init` (or `diffwiki templates init`) — not here.
- Idempotent; safe to re-run.
