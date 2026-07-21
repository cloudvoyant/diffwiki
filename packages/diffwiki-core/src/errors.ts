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
