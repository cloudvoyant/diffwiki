import { Command } from 'commander';
import {
  addExternalCollection,
  addTags,
  collectionGitStatus,
  createArticle,
  createCollection,
  doctor,
  getConfigValue,
  initRepoWiki,
  installPlugin,
  listCollections,
  listAvailablePlugins,
  listPlugins,
  listSearchModes,
  loadSearchProvider,
  search,
  registerPlugin,
  removeArticle,
  removePlugin,
  removeTags,
  resolveCwdCollection,
  setConfigValue,
  setTags,
  updateArticleBody,
  type Article,
  type DiagnosticLevel,
  type QueryOptions,
} from 'diffwiki-core';
import { version } from './version';
import { collect, splitTags, withErrors } from './runtime';
import { openBrowser, readState, isAlive, startUi, stopUi, waitForServer } from './ui-server';
import { runExport } from './exporter';

const icon = (level: DiagnosticLevel): string => (level === 'ok' ? '✓' : level === 'warn' ? '!' : '✖');

/** Build a fresh command tree. A new instance per call keeps e2e runs isolated. */
export function createProgram(): Command {
  const program = new Command();
  program
    .name('diffwiki')
    .description('A git-based knowledge base')
    .version(version)
    .showHelpAfterError()
    .option('-v, --verbose', 'verbose logging (sets the log level to debug)')
    .option('--log <level>', 'log level: trace|debug|info|warning|error|fatal');

  // NOTE: these flags are actually applied by configureCliLogging() (in bin.ts),
  // which reads process.argv at startup so logs are configured before any action
  // runs. They are declared here so --help lists them and Commander accepts them.

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
          const status = await collectionGitStatus(c);
          const branch = status?.branch ? `\t(${status.branch})` : '';
          console.log(`${c.name}\t[${c.type}]\t${c.path}${branch}`);
        }
      }),
    );

  program
    .command('add')
    .description('Add the current git repo as an external collection (docs dir, no diffwiki.yaml)')
    .option('-d, --docs <dir>', 'content dir relative to repo root', 'docs')
    .action(
      withErrors(async (opts: { docs: string }) => {
        const entry = await addExternalCollection({ cwd: process.cwd(), docsDir: opts.docs });
        const status = await collectionGitStatus(entry);
        const branch = status?.branch ? ` (${status.branch})` : '';
        console.log(`Added "${entry.name}"${branch} → ${entry.path}`);
        console.log('Registered globally — discoverable via: diffwiki list');
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
    .command('add-article')
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
    .command('update-article')
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
    .command('remove-article')
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
    .command('index')
    .description('Rebuild the search index via the active plugin')
    .option('--embed', 'also build vector embeddings (may download models on first run)')
    .action(
      withErrors(async (opts: { embed?: boolean }) => {
        const provider = await loadSearchProvider();
        if (!provider) {
          const installable = (await listSearchModes()).filter((m) => m.plugin !== 'native');
          console.log(
            installable.length > 0
              ? `No index-backed plugin active. Available modes: ${installable.map((m) => `${m.plugin}·${m.type}`).join(', ')}`
              : 'No search plugin installed — using native search (nothing to index). Install one with: diffwiki plugin install <spec>',
          );
          return;
        }
        const indexed = await provider.reindex(await listCollections(), { embed: !!opts.embed });
        console.log(`Indexed ${indexed} document(s).`);
      }),
    );

  program
    .command('query')
    .description('Search articles via the resolved search engine (native fallback if none)')
    .option('--engine <name>', 'search engine/plugin (default: config defaultSearch, else native)')
    .option('-c, --collection <name>', 'limit to a collection')
    .option('-t, --type <type>', 'search type (engine-defined, e.g. keyword|semantic|hybrid)')
    .argument('[term]', 'search term', '')
    .action(
      withErrors(async (term: string, opts: { engine?: string; collection?: string; type?: string }) => {
        const queryOpts: QueryOptions = { engine: opts.engine, collection: opts.collection, type: opts.type };
        const outcome = await search(term, queryOpts);
        const hits = outcome.hits;
        console.log(`${hits.length} result(s)`);
        for (const hit of hits) {
          // Lead with the score (mode-dependent scale) so it's easy to eyeball a
          // cutoff; `-` when the engine returned no score.
          const score = typeof hit.score === 'number' ? hit.score.toFixed(3) : '-';
          const line = `${score}\t${hit.collection}\t${hit.title}\t${hit.path}`;
          console.log(hit.snippet ? `${line}\t${hit.snippet}` : line);
        }
        if (outcome.error) {
          console.error(`⚠ engine "${outcome.engine}" failed: ${outcome.error} — used native (${hits.length} results)`);
        }
      }),
    );

  const plugin = program.command('plugin').description('Manage search plugins');

  plugin
    .command('install')
    .description('Install a search plugin from an npm spec and provision it (setup)')
    .argument('<spec>', 'npm package spec (name, name@version, or path)')
    .option('--no-setup', 'skip the end-to-end setup after install')
    .option('--no-default', 'do not make this the default search engine')
    .option('--prefetch-models', 'pre-download models during setup (heavy)')
    .action(
      withErrors(async (spec: string, opts: { setup: boolean; default: boolean; prefetchModels?: boolean }) => {
        const { record, setup, defaulted } = await installPlugin(spec, {
          setup: opts.setup,
          setDefault: opts.default,
          prefetchModels: opts.prefetchModels,
        });
        console.log(`Installed "${record.name}"${record.version ? ` v${record.version}` : ''}`);
        if (!opts.setup) {
          console.log('Skipped setup (--no-setup) — run: diffwiki index');
        } else if (setup && !setup.ready) {
          // Registered but not provisioned (e.g. a dependency didn't resolve).
          // Keep it registered — search degrades to native until it's ready.
          const reason = setup.steps.find((s) => !s.ok)?.message ?? 'setup did not complete';
          console.log(`⚠ Not ready: ${reason}`);
          console.log('  → run: diffwiki doctor');
        }
        if (defaulted) {
          console.log(
            `Set "${record.name}" as the default search engine (change: diffwiki config-set defaultSearch <engine[:type]>)`,
          );
        }
      }),
    );

  plugin
    .command('register')
    .description('Register an existing executable as a search plugin')
    .argument('<name>', 'plugin name')
    .requiredOption('--command <cmd...>', 'command argv to spawn the plugin (e.g. node /abs/adapter.js)')
    .action(
      withErrors(async (name: string, opts: { command: string[] }) => {
        const record = await registerPlugin(name, opts.command);
        console.log(`Registered "${record.name}" → ${record.command.join(' ')}`);
      }),
    );

  plugin
    .command('list')
    .description('List installed and available search plugins')
    .action(
      withErrors(async () => {
        const installed = await listPlugins();
        const installedNames = new Set(installed.map((p) => p.name));

        console.log('Installed:');
        if (installed.length === 0) {
          console.log('  (none)');
        } else {
          for (const p of installed) {
            console.log(
              `  ${p.name}\t${p.kind}\t${p.version ?? '-'}\tenabled=${p.enabled}\tmanaged=${!!p.managed}\tspawnable=${p.spawnable}`,
            );
          }
        }

        const available = listAvailablePlugins().filter((k) => !installedNames.has(k.name));
        if (available.length > 0) {
          console.log('\nAvailable (install with: diffwiki plugin install <name>):');
          for (const k of available) {
            console.log(`  ${k.name}\t[${k.kind}]\t${k.description}`);
            console.log(`    requires ${k.requires ?? 'nothing'}`);
          }
        }
      }),
    );

  plugin
    .command('remove')
    .description('Remove a search plugin')
    .argument('<name>', 'plugin name')
    .action(
      withErrors(async (name: string) => {
        await removePlugin(name);
        console.log(`Removed "${name}"`);
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
    .command('export')
    .description('Generate a static site (deployable to GitHub Pages)')
    .requiredOption('-o, --out <dir>', 'output directory')
    .option('-b, --base <path>', 'base URL path (e.g. /my-repo/ for GitHub Pages)', '/')
    .option('-f, --filter <globs>', 'only export collections matching these globs (comma-separated)')
    .option('-e, --exclude <globs>', 'exclude collections matching these globs (comma-separated)')
    .action(
      withErrors(async (opts: { out: string; base: string; filter?: string; exclude?: string }) => {
        await runExport({ out: opts.out, base: opts.base, filter: opts.filter, exclude: opts.exclude });
      }),
    );

  program
    .command('config-set')
    .description('Set a config value (e.g. defaultCollection, or defaultSearch <engine[:type]>)')
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
        const coll = await resolveCwdCollection(process.cwd());
        const target = coll ? `${state.url}/${encodeURIComponent(coll.name)}` : state.url;
        openBrowser(target);
        console.log(`Opening ${target}`);
      }),
    );

  return program;
}
