// api -------------------------------------------------------------------------

/** Base class for all expected, user-facing diffwiki failures. */
export class DiffwikiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CollectionExistsError extends DiffwikiError {
  constructor(name: string) {
    super(`collection "${name}" already exists`);
  }
}

export class CollectionNotFoundError extends DiffwikiError {
  constructor(name: string) {
    super(`collection "${name}" not found`);
  }
}

export class CollectionNotEmptyError extends DiffwikiError {
  constructor(name: string, count: number) {
    super(`collection "${name}" contains ${count} article(s) — pass --force to delete it`);
  }
}

export class NoDefaultCollectionError extends DiffwikiError {
  constructor() {
    super('no default collection set (use: diffwiki config-set defaultCollection <name>)');
  }
}

export class ArticleNotFoundError extends DiffwikiError {
  constructor(target: string) {
    super(`article "${target}" not found`);
  }
}

export class InvalidTargetError extends DiffwikiError {
  constructor(target: string, expected: string) {
    super(`invalid target "${target}" — ${expected}`);
  }
}

export class PluginError extends DiffwikiError {}

export class WorktreeNotAllowedError extends DiffwikiError {
  constructor(root: string) {
    super(`refusing to add a linked worktree — add the source repository instead (${root})`);
  }
}

export class CollectionAlreadyAddedError extends DiffwikiError {
  constructor(name: string) {
    super(`this repository is already added as collection "${name}"`);
  }
}

export class InvalidExportSelectionError extends DiffwikiError {
  constructor(problems: string[]) {
    super(`export aborted — ${problems.length} selection problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

export class SyncNotLinkedError extends DiffwikiError {
  constructor() {
    super('global wiki home is not linked to a remote repository (run: diffwiki link <owner/repo>)');
  }
}

export class SyncRemoteExistsError extends DiffwikiError {
  constructor(existingUrl: string, requestedUrl: string) {
    super(`global wiki home is already linked to "${existingUrl}" — pass --force to relink to "${requestedUrl}"`);
  }
}

export class SyncConflictError extends DiffwikiError {
  readonly conflicts: string[];

  constructor(conflicts: string[], recovery = 'diffwiki pull --continue | diffwiki pull --abort') {
    const details =
      conflicts.length > 0
        ? `rebase stopped with ${conflicts.length} conflicted file(s):\n${conflicts.map((c) => `  - ${c}`).join('\n')}`
        : 'sync stopped due to unresolved merge conflicts';
    super(`${details}\nResolve conflicts, then run: ${recovery}`);
    this.conflicts = conflicts;
  }
}

export class UnsupportedForgeError extends DiffwikiError {
  constructor(repo: string) {
    super(
      `unsupported forge remote "${repo}" — only GitHub remotes (<owner>/<repo> or github.com URLs) are supported right now`,
    );
  }
}

export class ForgeUnavailableError extends DiffwikiError {
  constructor(forge: string, detail: string) {
    super(`${forge} CLI is unavailable or unauthenticated: ${detail}`);
  }
}
