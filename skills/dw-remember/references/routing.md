# dw-remember — routing (project vs knowledge-base)

Pick the target collection by the NATURE of the knowledge, not where you happen to be.

| Knowledge is about… | Target |
|---|---|
| This repo/project: its architecture, build, conventions, gotchas, decisions | the repo's own collection (in-repo) |
| A language/framework/tool pattern reusable across projects | `knowledge-base`, or the matching language collection (`typescript`, `python`, `svelte`, …) |
| A CLI/dev tool recipe | `devtools` or the tool's collection |

Resolve candidates:
```bash
diffwiki collection list          # names + [type] + path
```
- In-repo collections have `[repo]`/`[external]`; global ones `[global]`.
- If the repo has a `diffwiki.yaml` `context.collections`, prefer targets from that set.

When ambiguous (could be project-specific OR general), ask the user once with the two concrete candidates. Default to the repo collection for anything that references this project by name.

Title rule: the title never repeats the collection/path. `typescript/pnpm-workspace.md` → title `Workspace Setup`, not `pnpm: Workspace Setup`.
