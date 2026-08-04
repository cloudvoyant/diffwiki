---
shape: recipe-with-steps
purpose: An ordered sequence — do X, then Y, then Z.
budget: [100, 1500]
---

<!--
Use this shape when the recipe is an ordered sequence — install X, then configure Y, then run Z. If there are no ordered steps, use `recipe-template.md` (simple) instead.

Authoring rules:
  - Adhere to the template structure
  - Number every step: `### Step 1 — <verb + object>`, and keep each step self-contained
  - If the sequence grows past ~7 steps, split into two recipes
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

Write two to four sentences of intro prose. State what the recipe accomplishes end-to-end, utilizing concrete tools and commands a reader would search for. Mention adjacent phrasings when possible so vector search hits from alternative wording.

## Recipe

One sentence framing the whole sequence — what state the reader is in when they start, and what state they're in when the last step succeeds.

### Step 1 — <verb + object>

One-sentence goal for the step.

```<lang>
<code — under ~70 lines>
```

Optional one-line verification (`<cmd> should print <result>`) or an inline link to the sub-topic.

### Step 2 — <verb + object>

One-sentence goal.

```<lang>
<code>
```

### Step 3 — <verb + object>

<...>

## Troubleshooting

<!-- Optional. Only real, specific problems. Cross-link to steps by name so retrieval keeps the connection. -->

- <Symptom during step N> — <root cause> — <fix>.
- <Symptom during step N> — <root cause> — <fix>.

## References

<!-- Do not omit even if references are also inline -->

- [<Name>](url) — <one-line reason (optional)>
- [<Related recipe>](../<collection>/<slug>.md) — <one-line reason (optional)>
