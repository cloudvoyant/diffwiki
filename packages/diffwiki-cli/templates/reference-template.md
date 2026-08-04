---
shape: reference
purpose: Authoritative description of commands, flags, config keys, types, or API endpoints — consult while working, not read linearly.
budget: [300, 2000]
---

<!--
Use this shape for lookup tables: CLI flags, config keys, environment variables, type definitions, API endpoints, error codes. A reference entry describes one item — its name, type, default, and effect. It does not explain why, teach, or walk through steps.

Authoring rules:
  - Adhere to the template structure
  - Organize entries by the system's own structure (group flags by command, keys by section) — not by frequency of use
  - One entry per item; keep descriptions to one sentence
  - Mark required entries explicitly; note all defaults
  - Add a minimal example only when the effect is not clear from the description alone
  - Do not add prose narration between entries
  - Soft-wrap prose in the intro and Notes sections only
  - Do not copy over html comments or the template specific yaml frontmatter above this section. Write a diffwiki article yaml frontmatter as shown below this comment.
  - Use concise descriptive titles in article frontmatter
  - Tag the system, language, or framework this reference covers
  - Default to public audience and draft status unless user specifies otherwise
-->

---

title: TITLE
tags:

- reference
- TAG1
- TAG2
- ...
  audience: public
  status: draft

---

One sentence: what system this page covers and the version or scope it applies to. Link to the upstream docs: [<System name>](<official-url>).

## <Command / Section / Group>

One sentence on what this command or group does.

| Flag / Key | Type | Default | Description |
|---|---|---|---|
| `<name>` | `<type>` | `<default>` | <one-sentence description> |
| `<name>` | `<type>` | — | **Required.** <one-sentence description> |

Minimal example where the flag combination is not obvious from the table:

```<lang>
<example>
```

## <Second command / section>

<same pattern>

## Notes

<!-- Optional. Warnings, known limits, version-specific behavior, or gotchas that apply across the whole reference — not to a single entry. -->

- <Warning or limit> — <what breaks and what to do instead>.

## References

<!-- Do not omit even if references are also inline -->

- [<Official docs>](<url>) — <one-line reason (optional)>
- [<Related recipe>](../<collection>/<slug>.md) — <one-line reason (optional)>
