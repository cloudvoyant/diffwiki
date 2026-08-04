# dw-learn — mine source material into knowledge drafts

Shared back-half for every dw-learn mode. Input: normalized source notes — a session/history transcript's five sections, or a repo's extracted notes. Output: deduped `status: draft` entries via `dw-remember`.

## 1. Cluster nuggets
Extract distinct, durable knowledge; discard one-off chatter, TODOs, and anything trivially obvious.
- A recurring problem → root cause → fix → **recipe** (add a Troubleshooting note).
- A repeated multi-step setup or command sequence → **recipe-with-steps**.
- A workflow, how-to, or architectural narrative → **guide**.

## 2. Route
Use `dw-remember` routing (`skills/dw-remember/references/routing.md`): route to the best-fit **existing** collection by subject — the repo's own collection for project-specific knowledge, the topic's collection (language/framework/tool/subject) for reusable knowledge — and propose a new collection when nothing fits. Do not assume a fixed structure.

## 3. Dedupe
For each candidate, `dw-recall <keywords>`. If the wiki already covers it, mark UPDATE (or drop). Prefer UPDATE over a duplicate CREATE.

## 4. Draft
For each approved candidate, invoke `dw-remember` (create/update, `status: draft`). Batch mode — do not show each entry individually. Cap the pass (default up to ~8 drafts); report anything skipped.

## 5. Summarize
List the sources processed and the drafts created/updated, then `diffwiki lint -c <touched collections>` and report health.

## Quality gate
A handful of high-value, well-referenced entries beats a flood of thin ones. Each entry stays in its template's token budget; split oversized nuggets. Never fabricate references — route candidates needing sources through `dw-remember --research`.
