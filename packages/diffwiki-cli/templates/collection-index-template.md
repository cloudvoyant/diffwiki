---
shape: collection-index
purpose: Groups and links a collection's articles — organises by topic, no prose narration.
budget: [100, 500]
---

<!--
Use this shape for a collection's root index file. An index groups articles into topics, provides a one-line description for each, and links to them. It does not teach, demonstrate, or narrate.

Authoring rules:
  - Adhere to the template structure
  - One H2 per topic group; keep the group label short (2–4 words)
  - One bullet per article: [Title](./slug.md) — one-line description
  - No prose paragraphs, no examples, no code blocks, no References section
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
- TAG2
  audience: public
  status: published

---

## <Topic Group>

- [Article Title](./slug.md) — one-line description of what this article covers.
- [Article Title](./slug.md) — one-line description of what this article covers.

## <Second Topic Group>

- [Article Title](./slug.md) — one-line description of what this article covers.
- [Article Title](./slug.md) — one-line description of what this article covers.
