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
