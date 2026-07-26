---
title: diffwiki-core
tags:
  - core
  - reference
order: 2
---

# diffwiki-core

`diffwiki-core` is the host-side API shared by the [CLI](/api-docs/cli) and the wiki app. It owns collections, the registry, article mutation, search routing, static-site builders, content rendering, the knowledge graph, and diagnostics. Import from the package barrel:

```ts
import { listCollections, search, buildNavTree } from 'diffwiki-core';
```

The plugin **authoring** SDK is a separate subpath export (`diffwiki-core/plugin`) and is documented on the [Plugin SDK](/api-docs/plugins) page. The pure BM25 scorer is additionally exposed browser-side via `diffwiki-core/bm25`. This reference covers the real exports of the barrel, grouped by area.

## Collections & registry

The registry (`~/.diffwiki/registry.json`) is the source of truth for which collections exist and where their content lives.

```ts
function listCollections(): Promise<CollectionEntry[]>
```
List every registered collection.

```ts
function findCollection(name: string): Promise<CollectionEntry | undefined>
```
Find a collection by name.

```ts
function findCollectionById(id: string): Promise<CollectionEntry | undefined>
```
Find a collection by its repo id (external collections).

```ts
function createCollection(name: string): Promise<CollectionEntry>
```
Create a `global` collection and register it. Throws `CollectionExistsError` if the name is taken.

```ts
function removeCollection(name: string): Promise<CollectionEntry>
```
Deregister a collection; for `global` collections the content directory is also deleted (repo/external wikis are left untouched).

```ts
function initRepoWiki(opts: InitOptions): Promise<CollectionEntry>
```
Initialize an in-repo wiki (`{ cwd, collection?, wikiPath? }`): create the wiki dir, write `diffwiki.yaml`, and register a `repo` collection. Names de-duplicate against existing collections.

```ts
function addExternalCollection(opts: AddExternalOptions): Promise<CollectionEntry>
```
Register the git repo containing `cwd` (`{ cwd, docsDir? }`, default `docs`) as an `external` collection; unique by repo id, refuses linked worktrees.

```ts
function resolveCwdCollection(cwd: string): Promise<CollectionEntry | undefined>
```
The registered collection the current directory belongs to (most-specific path wins), or `undefined`.

```ts
function collectionGitStatus(entry: CollectionEntry): Promise<CollectionGitStatus | undefined>
```
Branch + upstream ahead/behind for an external collection; `undefined` for non-external collections or when git is unavailable.

Lower-level registry access is also exported: `readRegistry`, `writeRegistry`, `registerCollection`, `unregisterCollection`.

## Project config

Read and resolve a repo's `diffwiki.yaml` (the `PROJECT_CONFIG_FILE`).

```ts
function readProjectConfig(dir: string): Promise<ProjectConfig | undefined>
```
Read and normalise the repo-root `diffwiki.yaml` — supports both the extended `{ site, collections[] }` form and the legacy single-collection `{ collection, path }` form. `undefined` when the file is absent.

```ts
function resolveProjectCollections(dir: string): Promise<CollectionEntry[]>
```
Resolve the config's collections into registry-shaped `CollectionEntry[]` with absolute paths. Empty when there is no config.

```ts
function readSiteConfig(dir: string): Promise<SiteConfig>
```
The `site` block from `diffwiki.yaml`, or `{}` when absent.

```ts
function seedProjectHome(dir: string): Promise<{ home: string; entries: CollectionEntry[] }>
```
Create a throwaway `DIFFWIKI_HOME` seeded with a registry built from the project's collections, so `preview` and `export --project` can render a repo's own wiki without touching the global registry. Throws when the config is missing or declares no collections; callers own cleanup.

## Articles

Create and mutate markdown articles. Targets are parsed with the exported helpers `parseAddTarget` (`"[collection:]title"`) and `parsePathTarget` (`"collection:path"`). Every mutation fires a best-effort plugin lifecycle event.

```ts
function createArticle(opts: { target: string; tags: string[]; body?: string }): Promise<Article>
```
Create an article; the filename is `slugify(title)`. Body defaults to a `# <title>` heading.

```ts
function updateArticleBody(target: string, body: string): Promise<Article>
```
Replace an article's body, preserving its title/tags/audience/status frontmatter.

```ts
function addTags(target: string, tags: string[]): Promise<Article>
function removeTags(target: string, tags: string[]): Promise<Article>
function setTags(target: string, tags: string[]): Promise<Article>
```
Union, subtract, or replace an article's tag set.

```ts
function removeArticle(target: string): Promise<string>
```
Delete an article file; returns the removed absolute path.

## Site builders

Pure-ish builders consumed by both the wiki app's server functions and the static exporter. In static builds (`DIFFWIKI_STATIC=1`) private/draft articles and collections are dropped.

```ts
function buildCollections(): Promise<CollectionInfo[]>
```
Every collection with its display title, git branch, and audience/status metadata.

```ts
function buildNavTree(): Promise<CollectionTree[]>
```
The full sidebar nav: per collection, the article tree mapped to routable `TreeNode`s.

```ts
function resolvePage(coll: string, slug: string, opts?: { include?: ReadonlySet<string> }): Promise<PageData | null>
```
Resolve a route to a rendered `doc` (HTML + toc + timestamps + local graph) or a generated directory `listing`; `null` when nothing matches. `opts.include` scopes the sidebar graph preview to a collection subset (subset exports).

```ts
function buildSearchIndex(collection?: string): Promise<SearchDoc[]>
```
One `SearchDoc` per article — routing metadata plus pre-tokenized ranked fields. Serialised by the exporter to `search-index.json` for offline browser search.

```ts
function buildLinkGraph(): Promise<LinkGraph>
```
The whole-wiki knowledge graph: one node per article, one directed edge per resolved internal link, plus tag-hub nodes. Memoised per process (`invalidateLinkGraph()` clears it).

```ts
function buildSiteConfig(): Promise<SiteConfig>
```
The site config for the current context, read from `diffwiki.yaml` at `DIFFWIKI_PROJECT_DIR`; `{}` when unset or unreadable. (Formerly `buildSite` — renamed to `buildSiteConfig`.)

## Selection

Pure export selection — no I/O.

```ts
function resolveCollectionSelection(all: string[], sel?: CollectionSelection): CollectionSelectionResult
```
Resolve `--filter`/`--exclude` globs over registered collection names. Returns `{ included, errors }`; reports (does not throw) unmatched patterns and empty-after-filter selections. A plain export of a wiki with zero collections is not an error.

## Search

Search routing precedence: explicit `opts.engine` → `config.defaultSearch` → first enabled plugin → native BM25.

```ts
function search(term: string, opts?: QueryOptions): Promise<SearchOutcome>
```
Primary search entry point. Returns `SearchOutcome` — the hits plus `{ engine, fellBackToNative, error? }` so a host can tell which engine ran and whether it silently degraded to native.

```ts
function query(term: string, opts?: QueryOptions): Promise<QueryHit[]>
```
Thin wrapper over `search` returning just the hits; engine errors are swallowed.

```ts
function nativeSearch(term: string, collections: CollectionEntry[], collection?: string): Promise<QueryHit[]>
```
The built-in BM25 full-text search over title, body, tags, and collection name across the given collections. An empty term returns all articles unranked.

```ts
function resolveDefaultSearchMode(): Promise<{ engine: string; type: string }>
```
The engine + type `query()` would use with no explicit options — read from cached registry capabilities, no subprocess spawn.

### Pure BM25 scorer

Zero Node/filesystem imports, so the identical ranking runs server-side and in the browser (also exposed via `diffwiki-core/bm25`).

```ts
function tokenize(text: string): string[]
```
Lowercase, split on non-alphanumeric, drop empties.

```ts
function rankDocs<T extends { fields: RankableFields }>(term: string, docs: T[]): Array<T & { score?: number }>
```
Rank pre-tokenized docs with BM25 over four weighted fields (title ×3, tags ×2, collection ×1.5, body ×1). An empty query returns every doc unranked; otherwise only matching docs, highest score first.

Types `RankableFields` and `SearchDoc` are exported alongside.

## Browse & render

```ts
function listArticleTree(coll: string): Promise<ArticleNode[]>
```
The nested article tree for a collection, enriched with frontmatter titles/audience/status and sorted by `order`.

```ts
function readArticle(coll: string, slug: string): Promise<ArticleContent>
```
Read and resolve a single article by collection + slug (tries `.mdx` then `.md`, then a directory index), guarding against path traversal.

```ts
function collectionMeta(collDir: string): Promise<{ title?; audience?; status? }>
```
A collection's title/audience/status from its index page (cheap partial read).

```ts
function buildArticleTree(relPaths: string[]): ArticleNode[]
```
Pure tree builder: nest a flat list of relative file paths (dirs-first, then alphabetical); index/README files are treated as folder indexes, not listed leaves.

```ts
function renderArticle(body: string, ctx: RenderContext): Promise<RenderedArticle>
```
Render a markdown body to Shiki-highlighted HTML plus its table of contents, rewriting relative inter-page links into in-app routes and collecting internal outgoing links (`coll/slug` ids) for the graph. Returns `{ html, toc, links }`.

## Graph

```ts
function buildLinkGraph(): Promise<LinkGraph>
```
See [Site builders](#site-builders) — the whole-wiki graph.

```ts
function localGraph(graph: LinkGraph, focusId: string, include?: ReadonlySet<string>, siblingCap?: number): LocalGraph
```
Slice the local neighbourhood of `focusId`: the focus, its direct link neighbours, its tag hubs, and up to `siblingCap` (default 12) co-tagged sibling articles. `include` prunes to a collection subset first.

```ts
function invalidateLinkGraph(): void
```
Clear the memoised whole-wiki graph.

## Diagnostics

```ts
function doctor(): Promise<Diagnostic[]>
```
Inspect the home directory, registry, collection paths, config, and every registered plugin, returning human-readable `Diagnostic[]` at `ok`/`warn`/`error` levels. Backs the [`diffwiki doctor`](/api-docs/cli) command.

## Also exported

The barrel additionally re-exports the core `types`, `errors`, path helpers (`resolveHome`, `registryPath`, `configPath`, `collectionsDir`, …), config access (`readConfig`, `writeConfig`, `setConfigValue`, `getConfigValue`), frontmatter helpers (`parseArticle`, `serializeArticle`), `slugify`, git helpers (`gitToplevel`, `repoId`, `upstreamStatus`, `fileTimestamps`, …), the plugin-management surface (`loadSearchProvider`, `listSearchModes`, `installPlugin`, `registerPlugin`, `removePlugin`, `listPlugins`, `listAvailablePlugins`, …), and LogTape logger accessors (`getLogger`, `resolveLogLevel`). Core never configures logging — apps do.
