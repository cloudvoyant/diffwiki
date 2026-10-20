# dw-learn — mine source material into knowledge drafts

Shared back-half for every dw-learn mode. Input: original requests, role-labeled session outputs, and source snippets with their locations. Output: source-backed `status: draft` entries via `dw-remember`. Keep the original packet alongside any routing notes.

## 1. Cluster nuggets
Select distinct, useful material supported by actual quotations, code, or observed outputs. Match the article shape to that evidence. Do not infer root causes, user preferences, or generalized lessons. If the support is missing or conflicting, skip the claim and report the gap. An assistant's prior explanation is not independent support.

## 2. Route
Use `dw-remember` routing (`skills/dw-remember/references/routing.md`): route to the best-fit **existing** collection by subject — the repo's own collection for project-specific knowledge, the topic's collection (language/framework/tool/subject) for reusable knowledge — and propose a new collection when nothing fits. Do not assume a fixed structure.

## 3. Dedupe
For each candidate, `dw-recall <keywords>`. If the wiki already covers it, mark UPDATE (or drop). Prefer UPDATE over a duplicate CREATE.

## 4. Draft
For each candidate, invoke `dw-remember` with the original evidence packet and locators (create/update, `status: draft`). It records relevant snippets through `source-capture.md`; do not pass only a summary or URL list. Batch mode: report the draft and source-record paths together. Cap the pass (default up to ~8 drafts); report anything skipped.

## 5. Summarize
List the sources processed and the drafts created/updated, then `diffwiki lint -c <touched collections>` and report health.

## Quality gate
A handful of high-value, well-referenced entries beats a flood of thin ones. Each entry stays in its template's token budget; split oversized nuggets. Never fabricate references — route candidates needing sources through `dw-remember --research`.
