import { spawn } from 'node:child_process';
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
  resolveEditorCommand,
  resolveEditTarget,
  setConfigValue,
  setTags,
  updateArticleBody,
  type Article,
  type DiagnosticLevel,
  type QueryOptions,
} from 'diffwiki-core';
import { version } from './version';
import { collect, deprecated, splitTags, withErrors } from './runtime';
import { openBrowser, readState, isAlive, startUi, stopUi, waitForServer } from './ui-server';
import { runExport } from './exporter';
import { runPreview } from './preview';

const icon = (level: DiagnosticLevel): string => (level === 'ok' ? '✓' : level === 'warn' ? '!' : '✖');

async function listCollectionsAction(): Promise<void> {
  const collections = await listCollections();
  if (collections.length === 0) {
    console.log('No collections yet. Create one with: diffwiki collection create <name>');
    return;
  }
  for (const c of collections) {
    const status = await collectionGitStatus(c);
    const branch = status?.branch ? `\t(${status.branch})` : '';
    console.log(`${c.name}\t[${c.type}]\t${c.path}${branch}`);
  }
}

async function addExternalAction(opts: { docs: string }): Promise<void> {
  const entry = await addExternalCollection({ cwd: process.cwd(), docsDir: opts.docs });
  const status = await collectionGitStatus(entry);
  const branch = status?.branch ? ` (${status.branch})` : '';
  console.log(`Added "${entry.name}"${branch} → ${entry.path}`);
  console.log('Registered globally — discoverable via: diffwiki collection list');
}

async function createCollectionAction(name: string): Promise<void> {
  const entry = await createCollection(name);
  console.log(`Created collection "${entry.name}" at ${entry.path}`);
}

async function createArticleAction(target: string, body: string | undefined, tags: string[]): Promise<void> {
  const article = await createArticle({
    target,
    tags: splitTags(tags),
    body,
  });
  console.log(article.path);
}

async function updateArticleAction(target: string, body: string): Promise<void> {
  const article = await updateArticleBody(target, body);
  console.log(`Updated ${article.path}`);
}

async function removeArticleAction(target: string): Promise<void> {
  const removed = await removeArticle(target);
  console.log(`Removed ${removed}`);
}

async function tagsAction(
  fn: (target: string, tags: string[]) => Promise<Article>,
  target: string,
  tags: string,
): Promise<void> {
  const article = await fn(target, splitTags([tags]));
  console.log(`${article.path} → tags: ${article.tags.join(', ') || '(none)'}`);
}

async function indexAction(opts: { embed?: boolean }): Promise<void> {
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
}

async function queryAction(term: string, opts: { engine?: string; collection?: string; type?: string }): Promise<void> {
  const queryOpts: QueryOptions = { engine: opts.engine, collection: opts.collection, type: opts.type };
  const outcome = await search(term, queryOpts);
  const hits = outcome.hits;
  console.log(`${hits.length} result(s)`);
  for (const hit of hits) {
    const score = typeof hit.score === 'number' ? hit.score.toFixed(3) : '-';
    const line = `${score}\t${hit.collection}\t${hit.title}\t${hit.path}`;
    console.log(hit.snippet ? `${line}\t${hit.snippet}` : line);
  }
  if (outcome.error) {
    console.error(`⚠ engine "${outcome.engine}" failed: ${outcome.error} — used native (${hits.length} results)`);
  }
}

async function pluginInstallAction(
  spec: string,
  opts: { setup: boolean; default: boolean; prefetchModels?: boolean },
): Promise<void> {
  const { record, setup, defaulted } = await installPlugin(spec, {
    setup: opts.setup,
    setDefault: opts.default,
    prefetchModels: opts.prefetchModels,
  });
  console.log(`Installed "${record.name}"${record.version ? ` v${record.version}` : ''}`);
  if (!opts.setup) {
    console.log('Skipped setup (--no-setup) — run: diffwiki search index');
  } else if (setup && !setup.ready) {
    const reason = setup.steps.find((s) => !s.ok)?.message ?? 'setup did not complete';
    console.log(`⚠ Not ready: ${reason}`);
    console.log('  → run: diffwiki doctor');
  }
  if (defaulted) {
    console.log(
      `Set "${record.name}" as the default search engine (change: diffwiki config set defaultSearch <engine[:type]>)`,
    );
  }
}

async function pluginRegisterAction(name: string, opts: { command: string[] }): Promise<void> {
  const record = await registerPlugin(name, opts.command);
  console.log(`Registered "${record.name}" → ${record.command.join(' ')}`);
}

async function pluginListAction(): Promise<void> {
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
}

async function pluginRemoveAction(name: string): Promise<void> {
  await removePlugin(name);
  console.log(`Removed "${name}"`);
}

async function initAction(opts: { collection?: string; path?: string }): Promise<void> {
  const entry = await initRepoWiki({
    cwd: process.cwd(),
    collection: opts.collection,
    wikiPath: opts.path,
  });
  console.log(`Initialized repo wiki "${entry.name}" at ${entry.path}`);
  console.log('Registered globally — discoverable via: diffwiki collection list');
}

async function exportAction(opts: {
  out: string;
  base: string;
  filter?: string;
  exclude?: string;
  project?: string | boolean;
}): Promise<void> {
  await runExport({
    out: opts.out,
    base: opts.base,
    filter: opts.filter,
    exclude: opts.exclude,
    project: opts.project,
  });
}

async function configSetAction(key: string, value: string): Promise<void> {
  await setConfigValue(key, value);
  console.log(`Set ${key} = ${value}`);
}

async function configGetAction(key: string): Promise<void> {
  const value = await getConfigValue(key);
  console.log(value ?? '(unset)');
}

async function doctorAction(): Promise<void> {
  const diagnostics = await doctor();
  for (const d of diagnostics) {
    console.log(`${icon(d.level)} ${d.message}`);
  }
  if (diagnostics.some((d) => d.level === 'error')) {
    process.exitCode = 1;
  }
}

async function upAction(opts: { port: string }): Promise<void> {
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
      : `Launched (pid ${state.pid}) but ${state.url} did not respond yet — check \`diffwiki ui status\``,
  );
}

async function downAction(): Promise<void> {
  const stopped = await stopUi();
  console.log(stopped ? `Stopped UI (pid ${stopped.pid})` : 'UI is not running.');
}

async function statusAction(): Promise<void> {
  const state = await readState();
  if (state && isAlive(state.pid)) {
    console.log(`running · ${state.url} · pid ${state.pid} · since ${state.startedAt}`);
  } else {
    console.log('stopped');
  }
}

async function openAction(opts: { port: string }): Promise<void> {
  let state = await readState();
  if (!state || !isAlive(state.pid)) {
    state = await startUi(Number(opts.port));
    await waitForServer(state.url);
  }
  const coll = await resolveCwdCollection(process.cwd());
  const target = coll ? `${state.url}/${encodeURIComponent(coll.name)}` : state.url;
  openBrowser(target);
  console.log(`Opening ${target}`);
}

async function editAction(target: string | undefined, editorFlag?: string): Promise<void> {
  const argv = await resolveEditorCommand(editorFlag);
  if (!argv) {
    console.error(
      'No editor set. Configure one: diffwiki config set editor "<cmd>" — or set $EDITOR, or pass --editor.',
    );
    process.exitCode = 1;
    return;
  }
  const { path: dest, kind } = await resolveEditTarget(target, process.cwd());
  const [cmd, ...args] = argv;
  console.log(`Opening ${kind} ${dest} with ${argv.join(' ')}`);
  const code = await new Promise<number>((resolve) => {
    const child = spawn(cmd, [...args, dest], { stdio: 'inherit' });
    child.on('error', (err) => {
      console.error(`Could not launch editor "${cmd}": ${err.message}`);
      resolve(127);
    });
    child.on('exit', (c) => resolve(c ?? 0));
  });
  if (code !== 0) process.exitCode = code;
}

async function previewAction(opts: { port: string }): Promise<void> {
  await runPreview({ cwd: process.cwd(), port: Number(opts.port) });
}

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

  // ── collection ────────────────────────────────────────────────────────────
  const collection = program.command('collection').description('Manage collections (containers)');

  collection.command('list').description('List all collections').action(withErrors(listCollectionsAction));

  collection
    .command('create')
    .description('Create a new global collection')
    .argument('<name>', 'collection name')
    .action(withErrors((name: string) => createCollectionAction(name)));

  collection
    .command('add')
    .description('Add the current git repo as an external collection (docs dir, no diffwiki.yaml)')
    .option('-d, --docs <dir>', 'content dir relative to repo root', 'docs')
    .action(withErrors((opts: { docs: string }) => addExternalAction(opts)));

  collection
    .command('init')
    .description('Initialize an in-repo wiki and register it globally')
    .option('-c, --collection <name>', 'collection name (default: repo name)')
    .option('-p, --path <path>', 'wiki path within the repo (default: wiki)')
    .action(withErrors((opts: { collection?: string; path?: string }) => initAction(opts)));

  collection
    .command('edit')
    .description('Open a collection in your editor — GUI not required')
    .argument('[name]', 'collection (default: the current repo collection)')
    .option('--editor <cmd>', 'editor command (overrides config `editor`, $VISUAL, $EDITOR)')
    .action(withErrors((name: string | undefined, opts: { editor?: string }) => editAction(name, opts.editor)));

  // ── article ───────────────────────────────────────────────────────────────
  const article = program.command('article').description('Manage articles (documents)');

  article
    .command('create')
    .description('Add an article to a collection')
    .argument('<target>', '"[collection:]title"')
    .argument('[body]', 'markdown body')
    .option('-t, --tag <tag>', 'tag (repeatable, comma-separated)', collect, [])
    .action(
      withErrors((target: string, body: string | undefined, opts: { tag: string[] }) =>
        createArticleAction(target, body, opts.tag),
      ),
    );

  article
    .command('update')
    .description("Replace an article's body")
    .argument('<target>', '"collection:slug"')
    .argument('<body>', 'new markdown body')
    .action(withErrors((target: string, body: string) => updateArticleAction(target, body)));

  article
    .command('remove')
    .description('Delete an article')
    .argument('<target>', '"collection:slug"')
    .action(withErrors((target: string) => removeArticleAction(target)));

  article
    .command('edit')
    .description('Open an article in your editor — GUI not required')
    .argument('<target>', '"collection:slug"')
    .option('--editor <cmd>', 'editor command (overrides config `editor`, $VISUAL, $EDITOR)')
    .action(withErrors((target: string, opts: { editor?: string }) => editAction(target, opts.editor)));

  // ── tags ──────────────────────────────────────────────────────────────────
  const tags = program.command('tags').description("Manage an article's tags");

  const registerTagsSub = (
    name: string,
    description: string,
    fn: (target: string, tags: string[]) => Promise<Article>,
  ): void => {
    tags
      .command(name)
      .description(description)
      .argument('<target>', '"collection:slug"')
      .argument('<tags>', 'comma-separated tags')
      .action(withErrors((target: string, tagList: string) => tagsAction(fn, target, tagList)));
  };
  registerTagsSub('add', "Add to an article's tags", addTags);
  registerTagsSub('remove', "Remove from an article's tags", removeTags);
  registerTagsSub('set', "Replace an article's tags", setTags);

  // ── search ────────────────────────────────────────────────────────────────
  const searchCmd = program.command('search').description('Search articles and manage the index');

  searchCmd
    .command('query')
    .alias('q')
    .description('Search articles via the resolved search engine (native fallback if none)')
    .option('--engine <name>', 'search engine/plugin (default: config defaultSearch, else native)')
    .option('-c, --collection <name>', 'limit to a collection')
    .option('-t, --type <type>', 'search type (engine-defined, e.g. keyword|semantic|hybrid)')
    .argument('[term]', 'search term', '')
    .action(
      withErrors((term: string, opts: { engine?: string; collection?: string; type?: string }) =>
        queryAction(term, opts),
      ),
    );

  searchCmd
    .command('index')
    .description('Rebuild the search index via the active plugin')
    .option('--embed', 'also build vector embeddings (may download models on first run)')
    .action(withErrors((opts: { embed?: boolean }) => indexAction(opts)));

  // ── plugin (unchanged) ──────────────────────────────────────────────────────
  const plugin = program.command('plugin').description('Manage search plugins');

  plugin
    .command('install')
    .description('Install a search plugin from an npm spec and provision it (setup)')
    .argument('<spec>', 'npm package spec (name, name@version, or path)')
    .option('--no-setup', 'skip the end-to-end setup after install')
    .option('--no-default', 'do not make this the default search engine')
    .option('--prefetch-models', 'pre-download models during setup (heavy)')
    .action(
      withErrors((spec: string, opts: { setup: boolean; default: boolean; prefetchModels?: boolean }) =>
        pluginInstallAction(spec, opts),
      ),
    );

  plugin
    .command('register')
    .description('Register an existing executable as a search plugin')
    .argument('<name>', 'plugin name')
    .requiredOption('--command <cmd...>', 'command argv to spawn the plugin (e.g. node /abs/adapter.js)')
    .action(withErrors((name: string, opts: { command: string[] }) => pluginRegisterAction(name, opts)));

  plugin
    .command('list')
    .description('List installed and available search plugins')
    .action(withErrors(pluginListAction));

  plugin
    .command('remove')
    .description('Remove a search plugin')
    .argument('<name>', 'plugin name')
    .action(withErrors((name: string) => pluginRemoveAction(name)));

  // ── site ──────────────────────────────────────────────────────────────────
  const site = program.command('site').description('Build and preview the published site');

  site
    .command('export')
    .description('Generate a static site (deployable to GitHub Pages)')
    .requiredOption('-o, --out <dir>', 'output directory')
    .option('-b, --base <path>', 'base URL path (e.g. /my-repo/ for GitHub Pages)', '/')
    .option('-f, --filter <globs>', 'only export collections matching these globs (comma-separated)')
    .option('-e, --exclude <globs>', 'exclude collections matching these globs (comma-separated)')
    .option('--project [dir]', 'build only the repo project from its diffwiki.yaml (default: cwd)')
    .action(
      withErrors((opts: { out: string; base: string; filter?: string; exclude?: string; project?: string | boolean }) =>
        exportAction(opts),
      ),
    );

  site
    .command('preview')
    .description('Preview the site from the repo diffwiki.yaml (ignores global collections)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(withErrors((opts: { port: string }) => previewAction(opts)));

  // ── ui ────────────────────────────────────────────────────────────────────
  const ui = program.command('ui').description('Run the local diffwiki app server');

  ui.command('up')
    .description('Start the diffwiki UI (latest published diffwiki-app)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(withErrors((opts: { port: string }) => upAction(opts)));

  ui.command('down').description('Stop the running diffwiki UI').action(withErrors(downAction));

  ui.command('status').description('Show whether the diffwiki UI is running').action(withErrors(statusAction));

  ui.command('open')
    .description('Open the diffwiki UI in the browser (starting it if needed)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(withErrors((opts: { port: string }) => openAction(opts)));

  // ── config ────────────────────────────────────────────────────────────────
  const config = program.command('config').description('Read and write diffwiki config');

  config
    .command('set')
    .description('Set a config value (e.g. defaultCollection, or defaultSearch <engine[:type]>)')
    .argument('<key>', 'config key')
    .argument('<value>', 'config value')
    .action(withErrors((key: string, value: string) => configSetAction(key, value)));

  config
    .command('get')
    .description('Read a config value')
    .argument('<key>', 'config key')
    .action(withErrors((key: string) => configGetAction(key)));

  // ── doctor (unchanged, top-level) ───────────────────────────────────────────
  program.command('doctor').description('Diagnose configuration issues').action(withErrors(doctorAction));

  // ── deprecated aliases (hidden; delegate to the same handlers) ──────────────
  registerDeprecatedAliases(program);

  return program;
}

/**
 * Register every pre-taxonomy command as a HIDDEN alias. Each keeps its original
 * flags/args, prints one deprecation line to stderr, then calls the identical shared
 * handler. Zero breaking changes: stdout and exit codes are unchanged.
 */
function registerDeprecatedAliases(program: Command): void {
  program.command('list', { hidden: true }).action(
    withErrors(() => {
      deprecated('list', 'collection list');
      return listCollectionsAction();
    }),
  );

  program
    .command('add', { hidden: true })
    .option('-d, --docs <dir>', 'content dir relative to repo root', 'docs')
    .action(
      withErrors((opts: { docs: string }) => {
        deprecated('add', 'collection add');
        return addExternalAction(opts);
      }),
    );

  program
    .command('create', { hidden: true })
    .argument('<name>', 'collection name')
    .action(
      withErrors((name: string) => {
        deprecated('create', 'collection create');
        return createCollectionAction(name);
      }),
    );

  program
    .command('add-article', { hidden: true })
    .requiredOption('-p, --path <target>', '"[collection:]title"')
    .option('-t, --tag <tag>', 'tag (repeatable, comma-separated)', collect, [])
    .argument('[body]', 'markdown body')
    .action(
      withErrors((body: string | undefined, opts: { path: string; tag: string[] }) => {
        deprecated('add-article', 'article create');
        return createArticleAction(opts.path, body, opts.tag);
      }),
    );

  program
    .command('update-article', { hidden: true })
    .requiredOption('-p, --path <target>', '"collection:path"')
    .argument('<body>', 'new markdown body')
    .action(
      withErrors((body: string, opts: { path: string }) => {
        deprecated('update-article', 'article update');
        return updateArticleAction(opts.path, body);
      }),
    );

  program
    .command('remove-article', { hidden: true })
    .requiredOption('-p, --path <target>', '"collection:path"')
    .action(
      withErrors((opts: { path: string }) => {
        deprecated('remove-article', 'article remove');
        return removeArticleAction(opts.path);
      }),
    );

  const registerDeprecatedTag = (
    name: string,
    newForm: string,
    fn: (target: string, tags: string[]) => Promise<Article>,
  ): void => {
    program
      .command(name, { hidden: true })
      .requiredOption('-p, --path <target>', '"collection:path"')
      .argument('<tags>', 'comma-separated tags')
      .action(
        withErrors((tagList: string, opts: { path: string }) => {
          deprecated(name, newForm);
          return tagsAction(fn, opts.path, tagList);
        }),
      );
  };
  registerDeprecatedTag('add-tags', 'tags add', addTags);
  registerDeprecatedTag('remove-tags', 'tags remove', removeTags);
  registerDeprecatedTag('update-tags', 'tags set', setTags);

  program
    .command('index', { hidden: true })
    .option('--embed', 'also build vector embeddings (may download models on first run)')
    .action(
      withErrors((opts: { embed?: boolean }) => {
        deprecated('index', 'search index');
        return indexAction(opts);
      }),
    );

  program
    .command('query', { hidden: true })
    .option('--engine <name>', 'search engine/plugin (default: config defaultSearch, else native)')
    .option('-c, --collection <name>', 'limit to a collection')
    .option('-t, --type <type>', 'search type (engine-defined, e.g. keyword|semantic|hybrid)')
    .argument('[term]', 'search term', '')
    .action(
      withErrors((term: string, opts: { engine?: string; collection?: string; type?: string }) => {
        deprecated('query', 'search query');
        return queryAction(term, opts);
      }),
    );

  program
    .command('init', { hidden: true })
    .option('-c, --collection <name>', 'collection name (default: repo name)')
    .option('-p, --path <path>', 'wiki path within the repo (default: wiki)')
    .action(
      withErrors((opts: { collection?: string; path?: string }) => {
        deprecated('init', 'collection init');
        return initAction(opts);
      }),
    );

  program
    .command('export', { hidden: true })
    .requiredOption('-o, --out <dir>', 'output directory')
    .option('-b, --base <path>', 'base URL path (e.g. /my-repo/ for GitHub Pages)', '/')
    .option('-f, --filter <globs>', 'only export collections matching these globs (comma-separated)')
    .option('-e, --exclude <globs>', 'exclude collections matching these globs (comma-separated)')
    .option('--project [dir]', 'build only the repo project from its diffwiki.yaml (default: cwd)')
    .action(
      withErrors(
        (opts: { out: string; base: string; filter?: string; exclude?: string; project?: string | boolean }) => {
          deprecated('export', 'site export');
          return exportAction(opts);
        },
      ),
    );

  program
    .command('config-set', { hidden: true })
    .argument('<key>', 'config key')
    .argument('<value>', 'config value')
    .action(
      withErrors((key: string, value: string) => {
        deprecated('config-set', 'config set');
        return configSetAction(key, value);
      }),
    );

  program
    .command('config-get', { hidden: true })
    .argument('<key>', 'config key')
    .action(
      withErrors((key: string) => {
        deprecated('config-get', 'config get');
        return configGetAction(key);
      }),
    );

  program
    .command('up', { hidden: true })
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(
      withErrors((opts: { port: string }) => {
        deprecated('up', 'ui up');
        return upAction(opts);
      }),
    );

  program.command('down', { hidden: true }).action(
    withErrors(() => {
      deprecated('down', 'ui down');
      return downAction();
    }),
  );

  program.command('status', { hidden: true }).action(
    withErrors(() => {
      deprecated('status', 'ui status');
      return statusAction();
    }),
  );

  program
    .command('open', { hidden: true })
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(
      withErrors((opts: { port: string }) => {
        deprecated('open', 'ui open');
        return openAction(opts);
      }),
    );

  program
    .command('edit', { hidden: true })
    .argument('[target]', 'collection or "collection:slug" (default: the current repo collection)')
    .option('--editor <cmd>', 'editor command (overrides config `editor`, $VISUAL, $EDITOR)')
    .action(
      withErrors((target: string | undefined, opts: { editor?: string }) => {
        deprecated('edit', 'collection edit / article edit');
        return editAction(target, opts.editor);
      }),
    );

  program
    .command('preview', { hidden: true })
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(
      withErrors((opts: { port: string }) => {
        deprecated('preview', 'site preview');
        return previewAction(opts);
      }),
    );
}
