# diffwiki authoring taxonomy (agent quick-reference)

Every knowledge entry fits ONE of five shapes; a sixth (transcript) is used only inside the hidden `transcripts` collection. Copy the template, write with extreme brevity. These budgets are what `diffwiki lint` enforces.

| Shape | Template | Token budget | Use when |
|---|---|---|---|
| recipe (simple) | `recipe-template.md` | 300–1000 | one contained pattern, one canonical example |
| recipe (with steps) | `recipe-with-steps-template.md` | 500–1500 | an ordered sequence: do X, then Y, then Z |
| guide | `guide-template.md` | 1500–5000 | ties several patterns together; narrative |
| system design | `system-design-template.md` | 2000–6000 | a whole system's architecture |
| component design | `component-design-template.md` | 1000–3000 | one component's contract + internals |
| session transcript | `session-transcript-template.md` | n/a (not linted) | dw-learn capture into the hidden `transcripts` collection |

Resolve a template: prefer `~/.diffwiki/templates/<name>` (user override), else the bundled copy.

## Hard rules (lint enforces the starred ones)

- ★ **References required.** Every knowledge entry has a `## References` section OR inline links — never neither. Guides/design docs MUST end with `## References`. References are real, verified sources, not placeholders.
- ★ **No `diffwiki-template` tag on instances.** Swap it for topic tags.
- ★ **Stay in budget.** Over the max is an error — split the file. Under the min is a warning — too thin.
- ★ **Draft is flagged.** New/updated entries ship `status: draft`; a human/reviewer promotes.
- **No `**Load when:**` prefix.** The intro prose IS the trigger.
- **Titles never repeat the path.** `bash/argument-parsing.md` → title `Argument Parsing`.
- **Inline links throughout; soft-wrap prose; code blocks < ~40 lines; one H2 per topic.**

## Brevity is the point
diffwiki entries load into LLM context. Verbosity is a defect. If a sentence doesn't change what the reader would do, delete it.

## Frontmatter is CLI-owned
Never hand-write frontmatter. Pass the BODY to `diffwiki article create/update -b`, set axes with `--status`, `--tag`, `--audience`. Transcripts use `--audience system` into the `transcripts` collection.
