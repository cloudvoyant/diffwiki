---
shape: collection-index
purpose: Groups and links a collection's articles — organises by topic, no prose narration.
budget: [100, 500]
---

<!--
Use this shape for a collection's root index file. An index groups articles into topics, provides a one-line description for each, and links to them. It does not teach, demonstrate, or narrate.

Pick an organisation pattern:
  - Subtopic headers — use when the collection spans multiple distinct subjects. One H2 per subject.
  - Shape-based sections — use when the collection covers a single topic but mixes article types. Use H2s: Guides, Recipes, References (omit any that are empty).

Authoring rules:
  - Adhere to the template structure
  - One H2 per topic group; keep the group label short (2–4 words)
  - One bullet per article: [Title](./slug.md) — one-line description
  - No prose paragraphs, no examples, no code blocks
  - Keep descriptions to a single clause — enough to distinguish siblings
  - Do not copy over html comments or the template specific yaml frontmatter above this section. Write a diffwiki article yaml frontmatter as shown below this comment.
  - Use concise descriptive titles in article frontmatter
  - Tag the collection topic and add collection-index tag
  - Default to public audience and published status for index files
-->

---

title: COLLECTION TITLE
tags:

- collection-index
- TAG1
  audience: public
  status: published

---

<!-- Pattern A: subtopic headers — use when the collection spans multiple subjects -->

## <Subject Area>

- [Article Title](./slug.md) — one-line description.
- [Article Title](./slug.md) — one-line description.

## <Second Subject Area>

- [Article Title](./slug.md) — one-line description.

<!-- Pattern B: shape-based sections — use when the collection is single-topic with mixed article types -->

## Guides

- [Article Title](./slug.md) — one-line description.

## Recipes

- [Article Title](./slug.md) — one-line description.
- [Article Title](./slug.md) — one-line description.

## References

- [Article Title](./slug.md) — one-line description.
