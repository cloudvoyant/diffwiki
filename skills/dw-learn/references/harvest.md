# dw-learn — transcript → knowledge candidates

Mine the captured `session-transcript` entries into durable knowledge.

## From each transcript section
- **Worked on / Key tool actions** — repeated command sequences → recipe-steps; one contained pattern → recipe.
- **Issues & learnings** — a problem→root-cause→fix → recipe (with a Troubleshooting note).
- **Decisions & patterns** — an architectural decision → system/component design or a guide section.
- **Open threads** — usually NOT wiki-worthy (they're TODOs), unless they encode a durable constraint.

## Nugget → target collection
Use `dw-remember` routing: project-specific → the repo collection; general/tool/language → knowledge-base or the language collection.

## Quality gate
Discard nuggets that are trivially obvious, one-off, or already covered (checked via `dw-recall`). A handful of high-value, well-referenced entries beats a flood of thin ones. Each entry stays in its template's token budget.
