---
title: "<Specific Topic>"
status: draft
tags: [diffwiki-template, recipe]
created: "2026-07-22T00:00:00.000Z"
updated: "2026-07-22T00:00:00.000Z"
---

<!--
RECIPE-WITH-STEPS TEMPLATE. Copy this file, replace `<...>` placeholders, then swap `diffwiki-template` in `tags` for the topic tag(s) — e.g. `[recipe, python, uv-workspace]`.

Use this shape when the recipe is an ordered sequence — install X, then configure Y, then run Z. If there are no ordered steps, use `recipe-template.md` (simple) instead.

Structure:
  - Intro prose — no bold `**Load when:**` prefix. Names the concrete tools, commands, or files a reader would search for.
  - `## Recipe` — sub-broken into `### Step N — <verb>` H3s. Each step has a short lead sentence, a code block, and any short verification note.
  - `## Troubleshooting` or `## Pitfalls` — optional, only for real gotchas.
  - `## References` — optional if links are already inline.

Step conventions:
  - Number every step: `### Step 1 — <verb + object>`, `### Step 2 — ...`.
  - Lead each step with one sentence stating the goal, then the code block.
  - Keep each step self-contained: a reader who lands mid-recipe should still understand that step.
  - If the count grows past ~7 steps, split into two recipes.

Authoring rules (see devtools/qmd/authoring-markdown):
  - `## Recipe` should stay under ~900 tokens even with steps inside. If it approaches, split into a Part 1 / Part 2 pair of recipes.
  - Code blocks under ~40 lines each.
  - Soft-wrap prose. Include synonyms for vector recall.
-->

Write two to four sentences of intro prose. State what the recipe accomplishes end-to-end, name the concrete tools and commands, and mention adjacent phrasings for vector recall. Link inline to prerequisites and adjacent recipes — for example, [`../<collection>/<prerequisite>.md`](../<collection>/<prerequisite>.md) or [the upstream docs](url).

## Recipe

One sentence framing the whole sequence — what state the reader is in when they start, and what state they're in when the last step succeeds.

### Step 1 — <verb + object>

One-sentence goal for the step.

```<lang>
<code>
```

Optional one-line verification (`<cmd> should print <result>`) or an inline link to the sub-topic.

### Step 2 — <verb + object>

One-sentence goal.

```<lang>
<code>
```

### Step 3 — <verb + object>

<...>

### Step 4 — <verb + object>

<...>

### Step 5 — <verb + object>

<...>

## Troubleshooting

<!-- Optional. Only real, specific problems. Cross-link to steps by name so retrieval keeps the connection. -->

- <Symptom during step N> — <root cause> — <fix>.
- <Symptom during step N> — <root cause> — <fix>.

## References

- [<Name>](url) — <one-line reason>
- [<Related recipe>](../<collection>/<slug>.md) — <one-line reason>
