# dw-learn — mine source material into knowledge drafts

Shared back-half for every dw-learn mode. Input: normalized source notes — a session/history transcript's five sections, or a repo's extracted notes. Output: deduped `status: draft` entries via `dw-remember`.

## 1. Cluster nuggets
Extract distinct, durable knowledge; discard one-off chatter, TODOs, and anything trivially obvious.
- A recurring problem → root cause → fix → **recipe** (add a Troubleshooting note).
- A repeated multi-step setup or command sequence → **recipe-with-steps**.
- A workflow or how-to → **guide**.
- An architectural decision or structure → **system-design** / **component-design**.

## 2. Route
Use `dw-remember` routing: project-specific knowledge → the repo's collection; general/tool/language knowledge → `knowledge-base` or the matching language collection.

## 3. Dedupe
For each candidate, `dw-recall <keywords>`. If the wiki already covers it, mark UPDATE (or drop). Prefer UPDATE over a duplicate CREATE.

## 4. Draft
For each approved candidate, invoke `dw-remember` (create/update, `status: draft`). Batch mode — do not show each entry individually. Cap the pass (default up to ~8 drafts); report anything skipped.

## 5. Summarize
List the sources processed and the drafts created/updated, then `diffwiki lint -c <touched collections>` and report health.

## Quality gate
A handful of high-value, well-referenced entries beats a flood of thin ones. Each entry stays in its template's token budget; split oversized nuggets. Never fabricate references — route candidates needing sources through `dw-remember --research`.
