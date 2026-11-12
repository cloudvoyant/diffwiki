# dw-remember — routing (pick the best-fit collection and nested subpath)

Route by the NATURE of the knowledge **and the collections that actually exist**. Fit the knowledge to the user's collections, nest subtopics under parent collections for better recall, and propose a new collection when nothing fits.

## 1. See what exists

```bash
diffwiki collection list          # names + [type] + path
```

- In-repo collections show `[repo]`/`[external]`; global ones show `[global]`.
- If the repo's `diffwiki.yaml` has `context.collections`, prefer targets from that set.

## 2. Pick the best fit by subject — and nest subtopics

Match the knowledge to the closest **existing** collection, and encourage **nested subpaths** (`<collection>/<subtopic>`) so related frameworks, libraries, and sub-domains stay grouped under one parent collection for recall:

- **About THIS repo/project** — its architecture, build, conventions, gotchas, decisions → the repo's own collection (or a nested folder like `<repo>/architecture`).
- **About a language / framework / ecosystem / subject** — route to the parent ecosystem collection and nest the specific framework or library underneath:
  - Specific React frameworks or libraries → `react/<framework>` (e.g. `react/nextjs`, `react/remix`, `react/tanstack`).
  - General Python libraries → `python/<library>` (e.g. `python/pydantic`, `python/fastapi`, `python/pytest`).
  - TypeScript libraries or tools → `typescript/<tool>` (e.g. `typescript/vitest`, `typescript/zod`).
  - General engineering / agent workflows → `<topic>/<subtopic>` (e.g. `devtools/git`, `ai/agents`).

Why nest: adding `react` or `python` once to `context.collections` recalls every nested framework and library under that collection without cluttering top-level collections.

## 3. Show the proposed target collection

Routing has an element of taste. Whenever you propose or confirm an article (in `dw-remember` or `dw-learn`), **always show the target collection path** (e.g. `react/tanstack`, `python/pydantic`, or `<collection>`) alongside the proposed title so the user can see and adjust where it will live.

If two collections or nesting levels could plausibly fit, show both and ask the user once.

## 4. No good fit? Propose a new collection.

Don't force knowledge into a poorly-matched collection. If nothing existing fits the parent topic, propose creating one (confirm once with the user, suggesting a name):

```bash
diffwiki collection create <topic>     # global parent topic (e.g. react, python, postgres)
# for project-specific knowledge that should live in the repo: /dw-init
```

## Default layout — only when the user hasn't set one up

If there are few or no collections yet, the sensible default is **one parent collection per broad language or domain** (e.g. `python`, `react`, `typescript`, `postgres`) with **nested folders for specific frameworks/libraries** (`react/nextjs`, `python/pydantic`), **plus one per project** (the repo's own wiki). Always honor the structure the user already has.

## Title — a human name, never the path

The article **title** is a short, human-readable phrase in Title Case — what a person would call the entry — **never a path or a slug**:

- ✅ `Add a Subcommand`, `Workspace Setup`, `Query Invalidation`
- ❌ `typescript/commander-cli/add-command`, `pnpm-workspace`, any slugified path

Pass nested targets as either `<collection>/<subpath>:<Human Title>` or `<collection>:<subpath>/<Human Title>`:

```bash
diffwiki article create "react/tanstack:Query Invalidation" -b "..." -t "recipe,react,tanstack" --status draft
```

The CLI places the file at `react/tanstack/query-invalidation.md` and writes the clean leaf title (`Query Invalidation`) into frontmatter.
