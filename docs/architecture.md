# Architecture

> diffwiki is a git-based personal knowledge base. This document describes the monorepo and the
> CLI scaffolded on Commander.

## Overview

diffwiki stores markdown/mdx notes in named **collections**. Global collections live under
`~/.diffwiki/collections/`; any repository can also host a wiki via `diffwiki init`. A single
`~/.diffwiki/registry.json` tracks every collection (global and repo) so tools can discover
them. `DIFFWIKI_HOME` overrides the global root (used for test isolation).

## Design

The repository is a pnpm workspace with two packages:

- **`diffwiki-core`** — plain, Promise-based TypeScript. Owns all state and filesystem logic:
  path resolution (`paths.ts`), the JSON config store (`config.ts`), the collection registry
  (`registry.ts`), collection creation (`collections.ts`), article CRUD and tag operations
  (`articles.ts`), in-repo `init` with `diffwiki.yaml` and conflict detection (`repo.ts`), a
  placeholder `query.ts`, and `doctor.ts` diagnostics. It throws typed `DiffwikiError`
  subclasses.
- **`diffwiki`** — the CLI, built with `commander`. Each subcommand's async action calls a
  core function directly and is wrapped by a `withErrors` helper that maps `DiffwikiError` to
  a clean stderr message and a non-zero exit code. `cli.ts` exports a `createProgram()`
  factory; `bin.ts` calls `createProgram().parseAsync(process.argv)`.

Both packages are plain TypeScript with no framework coupling; the core/CLI split keeps all
state logic synchronously testable.

## Implementation

- **Build**: both packages build with `tsup` (`moduleResolution: "Bundler"`, extensionless
  imports). The CLI's `tsconfig`/`vitest` map `diffwiki-core` to core's source, so typecheck
  and tests never depend on core being built first.
- **Testing**: core has vitest unit tests against a temp `DIFFWIKI_HOME`; the CLI has
  programmatic e2e tests (`createProgram().parseAsync`) plus a build-and-spawn smoke test.
- **Release**: the root package is private; both packages are publishable and share one
  version. semantic-release computes the version at the root and `@semantic-release/exec`
  stamps and builds both packages before publish.

## Future Work

- Real QMD-based search replaces the dummy `query`.
- CI publish-gating and per-package release artifacts (see the plan's Future Work).
