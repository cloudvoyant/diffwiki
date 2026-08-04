# dw-remember — routing (pick the best-fit collection)

Route by the NATURE of the knowledge **and the collections that actually exist**. There is no imposed structure — do NOT assume a `knowledge-base` vs `tools`/`devtools` split (that's just one possible layout). Fit the knowledge to the user's collections; if none fit, it may be right to start a new one.

## 1. See what exists

```bash
diffwiki collection list          # names + [type] + path
```

- In-repo collections show `[repo]`/`[external]`; global ones show `[global]`.
- If the repo's `diffwiki.yaml` has `context.collections`, prefer targets from that set.

## 2. Pick the best fit by subject

Match the knowledge to the closest **existing** collection:

- **About THIS repo/project** — its architecture, build, conventions, gotchas, decisions → the repo's own collection.
- **About a language / framework / tool / subject** — a reusable pattern → the collection dedicated to that topic, if one exists (e.g. a `typescript`, `svelte`, `helix`, `postgres` collection — whatever the user actually has).

If two collections could plausibly fit, ask the user once with the two closest candidates. Default to the repo collection for anything that names this project.

## 3. No good fit? Propose a new collection.

Don't force knowledge into a poorly-matched collection. If nothing existing fits the topic, propose creating one (confirm once with the user, suggesting a name):

```bash
diffwiki collection create <topic>     # global, cross-project topic (e.g. a language/framework/subject)
# for project-specific knowledge that should live in the repo: /dw-init
```

## Default layout — only when the user hasn't set one up

If there are few or no collections yet, the sensible default is **one collection per topic** (a language, framework, or subject — e.g. `typescript`, `terraform`, `kubernetes`) **plus one per project** (the repo's own wiki). This is a *suggestion for a blank slate*, not a rule — always honor the structure the user already has.

## Title — a human name, never the path

The article **title** is a short, human-readable phrase in Title Case — what a person would call the entry — **never a path or a slug**:

- ✅ `Add a Subcommand`, `Workspace Setup`, `Connection Pool Timeouts`
- ❌ `typescript/commander-cli/add-command`, `pnpm-workspace`, any slugified path

The collection organizes the entry and the CLI slugifies the filename for you — the title must not repeat the collection or path. Pass it as `diffwiki article create "<collection>:<Human Title>"`.
