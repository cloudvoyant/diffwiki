# Repository rules

Use `mise run <task>` for build, test, lint, and format commands. Check
`mise tasks` before choosing a command.

## Tests

Organize each test into `// Arrange`, `// Act`, and `// Assert` sections.
Keep setup in Arrange, the behavior under test in Act, and checks in Assert.
Split independent behaviors into separate tests rather than interleaving actions
and assertions. Shared setup and cleanup can remain in test hooks.

## TypeScript modules

In production modules, after imports, group declarations in this order: types,
public API, helpers.
Use `// types`, `// api`, and `// helpers` section labels, followed by a space
and hyphens through column 80. Keep implementation details in helpers; exported
functions and runtime constants belong in the API section. Omit empty sections.

## Git

Use Conventional Commits with an imperative subject of at most 72 characters.
Do not add AI attribution. Run appropriate checks before committing, pull with
rebase before pushing, and monitor CI for the pushed commit.
