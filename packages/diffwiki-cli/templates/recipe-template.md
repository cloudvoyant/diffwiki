---
shape: recipe
purpose: One contained pattern with a single canonical example.
budget: [300, 1000]
---

<!--
Use this shape when the recipe is one contained pattern: intro + a single canonical example + notes. No ordered steps. If the recipe has ordered steps, use `recipe-with-steps-template.md` instead.

Authoring rules:
  - Adhere to the template structure
  - Soft-wrap prose
  - Use inline references as needed for other wiki articles and external sources
  - Do not copy over html comments or the template specific yaml frontmatter above this section. Write a diffwiki article yaml frontmatter as shown below this comment.
  - Use concise descriptive titles in article frontmatter
  - Tag programming languages, frameworks, topics of relevance to support vector embedding/search
  - Default to public audience and draft status unless user specifies otherwise
-->

---

title: TITLE
tags:

- recipe
- TAG1
- TAG2
- ...
  audience: public
  status: draft

---

Write two to four sentences of intro prose. Describe what the recipe covers, utilizing concrete symbols and verbs a reader would search for. Mention adjacent phrasings when possible so vector search hits from alternative wording.

## Recipe

State the pattern in one sentence — what the code does and when to reach for it.

```<lang>
<code — the canonical example, under ~70 lines>
```

Follow-up notes only if the code isn't self-explanatory. Cover variations, edge cases, related recipes, etc.

## Troubleshooting

<!-- Optional. Include only if there are real, specific problems users hit. Skip if you'd otherwise write generic warnings. -->

- <Symptom> — <root cause> — <fix>.
- <Symptom> — <root cause> — <fix>.

## References

<!-- Do not omit even if references are also inline -->

- [<Name>](url) — <one-line reason (optional)>
- [<Related recipe>](../<collection>/<slug>.md) — <one-line reason (optional)>
