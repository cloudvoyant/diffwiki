# dw-learn repo — a local or external codebase

Learn durable knowledge from a code repository (this repo, another local path, or a remote git URL). No transcript is captured — you read the repo, extract notes, then mine them straight into drafts.

## 1. Resolve the source
- **No argument / `.`** → the current repo: `git rev-parse --show-toplevel`.
- **A local path** → use it directly, read-only.
- **A git URL** (`https://…`, `git@…`) → shallow-clone to a temp dir, read-only:
  ```bash
  dir=$(mktemp -d) && git clone --depth 1 "<url>" "$dir"
  ```
  Bound it: if the checkout exceeds ~500 MB (`du -sm "$dir"`), stop and report rather than mining a huge tree. Never clone into the diffwiki store. Remove the temp dir when done: `rm -rf "$dir"`.

## 2. Read the high-signal surface (do NOT read everything)
- `README*`, `docs/**`, `ARCHITECTURE*`, `CONTRIBUTING*`, and any ADRs (`docs/decisions/**`).
- Top-level structure (a shallow tree or `git ls-files | head`), package manifests (`package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`), and the main entry points.
- `git log --oneline -30` for recent themes.
- Respect `.gitignore`. Never read or echo secrets (`.env`, key files) — redact anything sensitive.

## 3. Extract notes
Capture, terse and factual: what the project is and its architecture; how to set it up and run it; key conventions and gotchas; notable patterns. This is raw material for mining — it is NOT a session transcript and is NOT written to the `transcripts` collection.

## 4. Route
- The user's OWN repo → its diffwiki collection.
- An EXTERNAL repo → `knowledge-base`, or a collection named for the repo if the user wants a dedicated one (`diffwiki collection create <repo-name>`). Tag external entries with the repo name and `external`.

## 5. Mine
Run `references/mine.md` over the extracted notes: architecture → system/component-design; setup/run → recipe-with-steps; conventions/gotchas → guide or recipe. Dedupe via `dw-recall`, draft via `dw-remember`.

## Safety
- Read-only on external repos; clone shallow; bound the size; clean up temp clones.
- Redact secrets/tokens. Cap the number of drafts (default ~8) and report what was skipped.
