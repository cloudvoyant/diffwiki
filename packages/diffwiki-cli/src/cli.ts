import { Command } from 'commander';
import {
  addTags,
  createArticle,
  createCollection,
  doctor,
  getConfigValue,
  initRepoWiki,
  listCollections,
  query,
  removeArticle,
  removeTags,
  setConfigValue,
  setTags,
  updateArticleBody,
  type Article,
  type DiagnosticLevel,
} from 'diffwiki-core';
import { version } from './version';
import { collect, splitTags, withErrors } from './runtime';
import { openBrowser, readState, isAlive, startUi, stopUi, waitForServer } from './ui-server';

const icon = (level: DiagnosticLevel): string => (level === 'ok' ? '✓' : level === 'warn' ? '!' : '✖');

/** Build a fresh command tree. A new instance per call keeps e2e runs isolated. */
export function createProgram(): Command {
  const program = new Command();
  program.name('diffwiki').description('A git-based knowledge base').version(version).showHelpAfterError();

  // No subcommand: show help and exit 0 (a bare invocation is not an error).
  program.action(() => {
    program.outputHelp();
  });

  program
    .command('list')
    .description('List all collections')
    .action(
      withErrors(async () => {
        const collections = await listCollections();
        if (collections.length === 0) {
          console.log('No collections yet. Create one with: diffwiki create <name>');
          return;
        }
        for (const c of collections) {
          console.log(`${c.name}\t[${c.type}]\t${c.path}`);
        }
      }),
    );

  program
    .command('create')
    .description('Create a new global collection')
    .argument('<name>', 'collection name')
    .action(
      withErrors(async (name: string) => {
        const entry = await createCollection(name);
        console.log(`Created collection "${entry.name}" at ${entry.path}`);
      }),
    );

  program
    .command('add')
    .description('Add an article to a collection')
    .requiredOption('-p, --path <target>', '"[collection:]title"')
    .option('-t, --tag <tag>', 'tag (repeatable, comma-separated)', collect, [])
    .argument('[body]', 'markdown body')
    .action(
      withErrors(async (body: string | undefined, opts: { path: string; tag: string[] }) => {
        const article = await createArticle({
          target: opts.path,
          tags: splitTags(opts.tag),
          body,
        });
        console.log(article.path);
      }),
    );

  program
    .command('update')
    .description("Replace an article's body")
    .requiredOption('-p, --path <target>', '"collection:path"')
    .argument('<body>', 'new markdown body')
    .action(
      withErrors(async (body: string, opts: { path: string }) => {
        const article = await updateArticleBody(opts.path, body);
        console.log(`Updated ${article.path}`);
      }),
    );

  program
    .command('remove')
    .description('Delete an article')
    .requiredOption('-p, --path <target>', '"collection:path"')
    .action(
      withErrors(async (opts: { path: string }) => {
        const removed = await removeArticle(opts.path);
        console.log(`Removed ${removed}`);
      }),
    );

  const registerTagCommand = (name: string, fn: (target: string, tags: string[]) => Promise<Article>): void => {
    program
      .command(name)
      .requiredOption('-p, --path <target>', '"collection:path"')
      .argument('<tags>', 'comma-separated tags')
      .action(
        withErrors(async (tags: string, opts: { path: string }) => {
          const article = await fn(opts.path, splitTags([tags]));
          console.log(`${article.path} → tags: ${article.tags.join(', ') || '(none)'}`);
        }),
      );
  };
  registerTagCommand('add-tags', addTags);
  registerTagCommand('remove-tags', removeTags);
  registerTagCommand('update-tags', setTags);

  program
    .command('query')
    .description('Search articles (dummy — QMD coming later)')
    .option('-c, --collection <name>', 'limit to a collection')
    .argument('[term]', 'search term', '')
    .action(
      withErrors(async (term: string, opts: { collection?: string }) => {
        const hits = await query(term, opts.collection);
        console.log(`(dummy search — QMD coming later) ${hits.length} result(s)`);
        for (const hit of hits) {
          console.log(`${hit.collection}\t${hit.title}\t${hit.path}`);
        }
      }),
    );

  program
    .command('init')
    .description('Initialize an in-repo wiki and register it globally')
    .option('-c, --collection <name>', 'collection name (default: repo name)')
    .option('-p, --path <path>', 'wiki path within the repo (default: wiki)')
    .action(
      withErrors(async (opts: { collection?: string; path?: string }) => {
        const entry = await initRepoWiki({
          cwd: process.cwd(),
          collection: opts.collection,
          wikiPath: opts.path,
        });
        console.log(`Initialized repo wiki "${entry.name}" at ${entry.path}`);
        console.log('Registered globally — discoverable via: diffwiki list');
      }),
    );

  program
    .command('config-set')
    .description('Set a config value (e.g. defaultCollection)')
    .argument('<key>', 'config key')
    .argument('<value>', 'config value')
    .action(
      withErrors(async (key: string, value: string) => {
        await setConfigValue(key, value);
        console.log(`Set ${key} = ${value}`);
      }),
    );

  program
    .command('config-get')
    .description('Read a config value')
    .argument('<key>', 'config key')
    .action(
      withErrors(async (key: string) => {
        const value = await getConfigValue(key);
        console.log(value ?? '(unset)');
      }),
    );

  program
    .command('doctor')
    .description('Diagnose configuration issues')
    .action(
      withErrors(async () => {
        const diagnostics = await doctor();
        for (const d of diagnostics) {
          console.log(`${icon(d.level)} ${d.message}`);
        }
        if (diagnostics.some((d) => d.level === 'error')) {
          process.exitCode = 1;
        }
      }),
    );

  program
    .command('up')
    .description('Start the diffwiki UI (latest published diffwiki-app)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(
      withErrors(async (opts: { port: string }) => {
        const existing = await readState();
        if (existing && isAlive(existing.pid)) {
          console.log(`UI already running at ${existing.url} (pid ${existing.pid})`);
          return;
        }
        const state = await startUi(Number(opts.port));
        const ok = await waitForServer(state.url);
        console.log(
          ok
            ? `UI started at ${state.url} (pid ${state.pid})`
            : `Launched (pid ${state.pid}) but ${state.url} did not respond yet — check \`diffwiki status\``,
        );
      }),
    );

  program
    .command('down')
    .description('Stop the running diffwiki UI')
    .action(
      withErrors(async () => {
        const stopped = await stopUi();
        console.log(stopped ? `Stopped UI (pid ${stopped.pid})` : 'UI is not running.');
      }),
    );

  program
    .command('status')
    .description('Show whether the diffwiki UI is running')
    .action(
      withErrors(async () => {
        const state = await readState();
        if (state && isAlive(state.pid)) {
          console.log(`running · ${state.url} · pid ${state.pid} · since ${state.startedAt}`);
        } else {
          console.log('stopped');
        }
      }),
    );

  program
    .command('open')
    .description('Open the diffwiki UI in the browser (starting it if needed)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(
      withErrors(async (opts: { port: string }) => {
        let state = await readState();
        if (!state || !isAlive(state.pid)) {
          state = await startUi(Number(opts.port));
          await waitForServer(state.url);
        }
        openBrowser(state.url);
        console.log(`Opening ${state.url}`);
      }),
    );

  return program;
}
