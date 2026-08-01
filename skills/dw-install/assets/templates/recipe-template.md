---
title: "<Specific Topic>"
status: draft
tags: [diffwiki-template, recipe]
created: '2026-07-22T00:00:00.000Z'
updated: '2026-07-22T00:00:00.000Z'
---

<!--
RECIPE TEMPLATE (simple). Copy this file, replace `<...>` placeholders, then swap `diffwiki-template` in `tags` for the topic tag(s) — e.g. `[recipe, bash, argument-parsing]`.

Use this shape when the recipe is one contained pattern: intro + a single canonical example + notes. No ordered steps. If the recipe has ordered steps, use `recipe-with-steps-template.md` instead.

Structure:
  - Intro prose — no bold `**Load when:**` prefix. Names the concrete symbols, verbs, or APIs a reader would search for. Two to four sentences.
  - `## Recipe` — the canonical example plus follow-up notes. No H3s.
  - `## Troubleshooting` or `## Pitfalls` — optional. Only include if there are real, specific gotchas.
  - `## References` — optional. Also embed inline links throughout so each chunk carries its own references.

Authoring rules (see devtools/qmd/authoring-markdown):
  - One H2 per topic. Keep sections under ~900 tokens.
  - Descriptive headings; no glossy "Setup" / "Notes".
  - Code blocks under ~40 lines each.
  - Soft-wrap prose. Include synonyms for vector recall.
-->

Write two to four sentences of intro prose. Describe what the recipe covers, name the concrete symbols and verbs a reader would search for, and mention adjacent phrasings so vector search hits from alternative wording. This paragraph is the implicit load-when — no bold prefix. Link inline to related recipes like [conditionals](./conditionals.md) or upstream docs like [the Bash reference](https://www.gnu.org/software/bash/manual/bash.html) when the reader benefits from them.

## Recipe

State the pattern in one sentence — what the code does and when to reach for it.

```<lang>
<code — the canonical example, under ~40 lines>
```

Follow-up notes only if the code isn't self-explanatory. Cover variations, edge cases, and inline references such as [`../<collection>/<related>.md`](../<collection>/<related>.md).

## Troubleshooting

<!-- Optional. Include only if there are real, specific problems users hit. Skip if you'd otherwise write generic warnings. -->

- <Symptom> — <root cause> — <fix>.
- <Symptom> — <root cause> — <fix>.

## References

<!-- Optional if every reference is already inline. Include when the recipe cites more than three external sources. -->

- [<Name>](<url>) — <one-line reason>
- [<Related recipe>](../<collection>/<slug>.md) — <one-line reason>
