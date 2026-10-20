import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Command, Option } from 'commander';
import {
  addExternalCollection,
  addTags,
  collectionGitStatus,
  createArticle,
  createCollection,
  createMetaRecord,
  initMeta,
  reindexMeta,
  findCollection,
  parseFrontmatter,
  CollectionNotFoundError,
  DiffwikiError,
  doctor,
  getConfigValue,
  initRepoWiki,
  installPlugin,
  lintCollections,
  listCollections,
  listAvailablePlugins,
  listPlugins,
  listSearchModes,
  loadSearchProvider,
  search,
  registerPlugin,
  removeArticle,
  removePlugin,
  repairPlugins,
  removeTags,
  seedTemplates,
  listTemplates,
  readContextCollections,
  setContextCollections,
  resolveDefaultSearchMode,
  resolveCwdCollection,
  resolveEditorCommand,
  resolveEditTarget,
  setConfigValue,
  setTags,
  updateArticle,
  type Article,
  type Audience,
  type DiagnosticLevel,
  type PublishStatus,
  type QueryOptions,
  type MetaKind,
  type MetaResult,
  type TemplateCategory,
} from 'diffwiki-core';
import { version } from './version';
import { collect, splitTags, withErrors } from './runtime';
import { openBrowser, readState, isAlive, startUi, stopUi, waitForServer, childExited } from './ui-server';
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

async function createCollectionAction(name: string, opts: { hidden?: boolean }): Promise<void> {
  const entry = await createCollection(name, opts.hidden ? { audience: 'system' } : undefined);
  console.log(`Created ${entry.audience === 'system' ? 'hidden ' : ''}collection "${entry.name}" at ${entry.path}`);
}

interface ArticleMetaOpts {
  title?: string;
  body?: string;
  tag: string[];
  audience?: Audience;
  status?: PublishStatus;
}

async function createArticleAction(target: string, opts: ArticleMetaOpts): Promise<void> {
  const article = await createArticle({
    target,
    tags: splitTags(opts.tag),
    body: opts.body,
    audience: opts.audience,
    status: opts.status,
  });
  console.log(article.path);
}

async function updateArticleAction(target: string, opts: ArticleMetaOpts): Promise<void> {
  const tagList = splitTags(opts.tag);
  const hasMeta = opts.audience !== undefined || opts.status !== undefined;
  if (opts.title === undefined && opts.body === undefined && tagList.length === 0 && !hasMeta) {
    console.error('Nothing to update — pass --title, -b/--body, -t/--tag, --audience, and/or --status.');
    process.exitCode = 1;
    return;
  }
  const article = await updateArticle(target, {
    title: opts.title,
    body: opts.body,
    ...(tagList.length ? { tags: tagList } : {}),
    audience: opts.audience,
    status: opts.status,
  });
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
  // Index the engine the user actually searches with (config.defaultSearch),
  // not just the first enabled plugin — otherwise a no-index engine registered
  // ahead of the real one (e.g. ripgrep before qmd) would swallow the reindex.
  const { engine } = await resolveDefaultSearchMode();
  const provider = await loadSearchProvider(engine);
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

async function queryAction(
  term: string,
  opts: { engine?: string; collection?: string; type?: string; lex?: string[]; vec?: string[]; hyde?: string[] },
): Promise<void> {
  const names = opts.collection
    ? opts.collection
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const expansions = [
    ...(opts.lex ?? []).map((query) => ({ type: 'lex' as const, query })),
    ...(opts.vec ?? []).map((query) => ({ type: 'vec' as const, query })),
    ...(opts.hyde ?? []).map((query) => ({ type: 'hyde' as const, query })),
  ];
  const queryOpts: QueryOptions = {
    engine: opts.engine,
    collection: names && names.length === 1 ? names[0] : names,
    type: opts.type,
    ...(expansions.length > 0 ? { expansions } : {}),
  };
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

async function doctorAction(opts: { fix?: boolean }): Promise<void> {
  if (opts.fix) {
    // Re-provision each enabled plugin: this re-runs `setup`, which auto-installs
    // missing system tools (rg/fzf via mise/brew; qmd via npm) before diagnosing.
    console.log('Repairing plugins (installing missing tools)…');
    const repairs = await repairPlugins();
    for (const r of repairs) {
      for (const step of r.setup.steps) {
        console.log(
          `${icon(step.ok ? 'ok' : 'warn')} ${r.name} · ${step.step}${step.message ? ` — ${step.message}` : ''}`,
        );
      }
    }
    console.log('');
  }
  const diagnostics = await doctor();
  for (const d of diagnostics) {
    console.log(`${icon(d.level)} ${d.message}`);
  }
  if (diagnostics.some((d) => d.level === 'error')) {
    process.exitCode = 1;
  }
}

/** The authoring templates bundled with the CLI: `dist/bin.js` → `../templates`. */
function bundledTemplatesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
}

async function templatesInitAction(): Promise<void> {
  const { seeded, skipped, dir } = await seedTemplates(bundledTemplatesDir());
  console.log(`Templates → ${dir}`);
  if (seeded.length > 0) console.log(`  seeded: ${seeded.join(', ')}`);
  if (skipped.length > 0) console.log(`  kept existing (user overrides): ${skipped.join(', ')}`);
  if (seeded.length === 0 && skipped.length === 0) console.log('  (no bundled templates found)');
}

async function templatesListAction(opts: { json?: boolean; category?: TemplateCategory | 'all' }): Promise<void> {
  const infos = await listTemplates(bundledTemplatesDir(), opts.category);
  if (infos.length === 0) {
    console.log('No templates found.');
    return;
  }
  if (opts.json) {
    console.log(JSON.stringify(infos, null, 2));
    return;
  }
  // Human table: shape, purpose, budget — read from each template's frontmatter.
  for (const t of infos) {
    const budget = t.budget ? `  [${t.budget[0]}–${t.budget[1]} tok]` : '';
    console.log(`${t.shape}\t${t.purpose}${budget}`);
  }
}

function reportMeta(result: MetaResult, opts: { json?: boolean }): void {
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Metadata: ${result.created.length} mirrors created, ${result.kept.length} kept.`);
    for (const file of result.index_paths) console.log(file);
  }
  for (const warning of result.warnings) console.error(`! ${warning}`);
  for (const error of result.errors) console.error(`✖ ${error}`);
  if (result.errors.length) process.exitCode = 1;
}

async function metaInitAction(name: string | undefined, opts: { json?: boolean }): Promise<void> {
  const entries = name ? [await findCollection(name)] : await listCollections();
  if (entries.some((entry) => !entry)) throw new CollectionNotFoundError(name!);
  reportMeta(await initMeta(entries.filter((entry) => entry !== undefined)), opts);
}

async function metaNewAction(target: string, opts: { template: MetaKind; json?: boolean }): Promise<void> {
  const colon = target.indexOf(':');
  const name = colon < 0 ? target : target.slice(0, colon);
  const articlePath = colon < 0 ? undefined : target.slice(colon + 1);
  const entry = await findCollection(name);
  if (!entry) throw new CollectionNotFoundError(name);
  const template = (await listTemplates(bundledTemplatesDir(), 'meta')).find((item) => item.shape === opts.template);
  if (!template) throw new DiffwikiError(`Metadata template ${opts.template} not found. Run: diffwiki templates init`);
  try {
    const { body } = parseFrontmatter(await readFile(template.path, 'utf8'));
    const record = await createMetaRecord(entry, articlePath, opts.template, body.replace(/<!--[\s\S]*?-->/g, ''));
    console.log(opts.json ? JSON.stringify(record, null, 2) : record.path);
  } catch (err) {
    if (err instanceof DiffwikiError) throw err;
    throw new DiffwikiError(`Cannot capture ${target}: ${String(err)}`);
  }
}

// ── recall context (diffwiki.yaml → context.collections) ─────────────────────
const parseNames = (csv: string): string[] =>
  csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Warn (soft) about context names that aren't registered collections. */
async function warnUnknownCollections(names: string[]): Promise<void> {
  const known = new Set((await listCollections()).map((c) => c.name));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    console.error(`! not in your collections: ${unknown.join(', ')} (see: diffwiki collection list)`);
  }
}

function reportContext(collections: string[], file: string): void {
  console.log(`context.collections = [${collections.join(', ')}] → ${file}`);
}

async function contextShowAction(): Promise<void> {
  const cols = await readContextCollections(process.cwd());
  if (cols.length === 0) {
    console.log('No recall context set. Set one: diffwiki context set <a,b,c>');
    return;
  }
  for (const c of cols) console.log(c);
}

async function contextSetAction(names: string): Promise<void> {
  const cols = parseNames(names);
  const file = await setContextCollections(process.cwd(), cols);
  await warnUnknownCollections(cols);
  reportContext(cols, file);
}

async function contextAddAction(names: string): Promise<void> {
  const merged = await readContextCollections(process.cwd());
  for (const n of parseNames(names)) if (!merged.includes(n)) merged.push(n);
  const file = await setContextCollections(process.cwd(), merged);
  await warnUnknownCollections(merged);
  reportContext(merged, file);
}

async function contextRemoveAction(names: string): Promise<void> {
  const drop = new Set(parseNames(names));
  const kept = (await readContextCollections(process.cwd())).filter((c) => !drop.has(c));
  const file = await setContextCollections(process.cwd(), kept);
  reportContext(kept, file);
}

async function lintAction(opts: { collections: string }): Promise<void> {
  const result = await lintCollections(opts.collections);
  for (const file of result.files) {
    if (file.findings.length === 0) {
      console.log(`✓ ${file.path}`);
      continue;
    }
    for (const f of file.findings) {
      console.log(`${f.level === 'error' ? '✖' : '!'} ${file.path}: ${f.message}`);
    }
  }
  console.log(`\n${result.fileCount} file(s), ${result.errorCount} error(s), ${result.warnCount} warning(s)`);
  if (result.errorCount > 0) process.exitCode = 1;
}

/** A human-readable description of why a spawned child exited. */
function exitReason(child: ChildProcess): string {
  if (child.exitCode !== null) return `exit ${child.exitCode}`;
  if (child.signalCode !== null) return `signal ${child.signalCode}`;
  return 'unexpectedly';
}

async function upAction(opts: { port: string }): Promise<void> {
  const existing = await readState();
  if (existing && isAlive(existing.pid)) {
    console.log(`UI already running at ${existing.url} (pid ${existing.pid})`);
    return;
  }
  const { state, child } = await startUi(Number(opts.port));
  const ok = await waitForServer(state.url);
  const exited = await childExited(child, ok ? 2000 : 0);
  if (exited) {
    await stopUi();
    if (ok) {
      const held = await waitForServer(state.url, 1500);
      if (held) {
        console.error(`Port ${state.port} is already in use by another process — the diffwiki app could not bind.`);
        console.error(`Stop that process, or start the UI on a free port: \`diffwiki ui up --port <port>\`.`);
      } else {
        console.error(
          `The diffwiki app started serving on ${state.url} but exited again (${exitReason(child)}) — check \`diffwiki ui status\`.`,
        );
      }
    } else {
      console.error(
        `The diffwiki app exited (${exitReason(child)}) before it could serve ${state.url} — check \`diffwiki ui status\`.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  if (ok) {
    console.log(`UI started at ${state.url} (pid ${state.pid})`);
    return;
  }
  console.log(`Launched (pid ${state.pid}) but ${state.url} did not respond yet — check \`diffwiki ui status\``);
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
    const started = await startUi(Number(opts.port));
    state = started.state;
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
    .option('--hidden', 'create as a hidden system collection (audience: system)')
    .action(withErrors((name: string, opts: { hidden?: boolean }) => createCollectionAction(name, opts)));

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
    .option('-b, --body <markdown>', 'article body (default: a "# <title>" heading)')
    .option('-t, --tag <tag>', 'tag (repeatable, comma-separated)', collect, [])
    .addOption(
      new Option('--audience <audience>', 'visibility (default: public)').choices(['public', 'private', 'system']),
    )
    .addOption(
      new Option('--status <status>', 'publish status (default: published)').choices([
        'draft',
        'published',
        'deprecated',
      ]),
    )
    .action(withErrors((target: string, opts: ArticleMetaOpts) => createArticleAction(target, opts)));

  article
    .command('update')
    .description("Update an article's display title, body, tags, audience, and/or status")
    .argument('<target>', '"collection:slug"')
    .option('--title <title>', 'set the display title without renaming the file')
    .option('-b, --body <markdown>', 'replace the article body')
    .option('-t, --tag <tag>', 'replace all tags (repeatable, comma-separated)', collect, [])
    .addOption(new Option('--audience <audience>', 'set visibility').choices(['public', 'private', 'system']))
    .addOption(new Option('--status <status>', 'set publish status').choices(['draft', 'published', 'deprecated']))
    .action(withErrors((target: string, opts: ArticleMetaOpts) => updateArticleAction(target, opts)));

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
    .option('-c, --collection <names>', 'limit to a collection (comma-separated for a set)')
    .option('-t, --type <type>', 'search type (engine-defined, e.g. keyword|semantic|hybrid)')
    // Pre-expanded query variants (repeatable). Lets an upstream LLM/agent do the
    // query expansion and hand the engine typed sub-queries directly, e.g.
    //   diffwiki search q "add a cli subcommand" \
    //     --lex "commander subcommand" --vec "how to add a CLI verb" --hyde "..."
    .option('--lex <query>', 'BM25 keyword variant (repeatable)', collect, [])
    .option('--vec <query>', 'semantic variant — a natural-language question (repeatable)', collect, [])
    .option('--hyde <query>', 'hypothetical-answer passage variant (repeatable)', collect, [])
    .argument('[term]', 'search term (used as ranking intent when variants are given)', '')
    .action(
      withErrors(
        (
          term: string,
          opts: { engine?: string; collection?: string; type?: string; lex: string[]; vec: string[]; hyde: string[] },
        ) => queryAction(term, opts),
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
    .description('Start the diffwiki UI (runs the matching published diffwiki-app)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(withErrors((opts: { port: string }) => upAction(opts)));

  ui.command('down').description('Stop the running diffwiki UI').action(withErrors(downAction));

  ui.command('status').description('Show whether the diffwiki UI is running').action(withErrors(statusAction));

  ui.command('open')
    .description('Open the diffwiki UI in the browser (starting it if needed)')
    .option('-p, --port <port>', 'port to serve on', '4321')
    .action(withErrors((opts: { port: string }) => openAction(opts)));

  // ── config ────────────────────────────────────────────────────────────────
  // ── context ───────────────────────────────────────────────────────────────
  const context = program
    .command('context')
    .description('Manage recall/search context (diffwiki.yaml → context.collections)');
  context
    .command('show')
    .description('Print the current recall-context collections')
    .action(withErrors(contextShowAction));
  context
    .command('set')
    .description('Replace the recall-context collections')
    .argument('<names>', 'comma-separated collection names')
    .action(withErrors((names: string) => contextSetAction(names)));
  context
    .command('add')
    .description('Add collections to the recall context')
    .argument('<names>', 'comma-separated collection names')
    .action(withErrors((names: string) => contextAddAction(names)));
  context
    .command('remove')
    .description('Remove collections from the recall context')
    .argument('<names>', 'comma-separated collection names')
    .action(withErrors((names: string) => contextRemoveAction(names)));

  // ── templates ───────────────────────────────────────────────────────────────
  const meta = program.command('meta').description('Capture raw sources beside collection and article paths');
  meta
    .command('init')
    .description('Create missing source manifests for existing articles')
    .argument('[collection]', 'limit to one registered collection')
    .option('--json', 'output paths and diagnostics as JSON')
    .action(withErrors(metaInitAction));
  meta
    .command('new')
    .description('Create a source-record template for a collection or exact article filename')
    .argument('<target>', 'collection or collection:relative-file.md')
    .addOption(
      new Option('--template <kind>', 'source template')
        .choices(['history', 'external-source-extract', 'dream-learning'])
        .makeOptionMandatory(),
    )
    .option('--json', 'output the record and index paths as JSON')
    .action(withErrors(metaNewAction));
  meta
    .command('reindex')
    .description('Refresh generated source listings from current metadata files')
    .argument('[collection]', 'limit to one metadata collection')
    .option('--json', 'output paths and diagnostics as JSON')
    .action(
      withErrors(async (name: string | undefined, opts: { json?: boolean }) =>
        reportMeta(await reindexMeta(name), opts),
      ),
    );

  const templates = program.command('templates').description('Manage authoring templates (~/.diffwiki/templates)');
  templates
    .command('init')
    .description('Seed ~/.diffwiki/templates from the bundled templates (never overwrites your own)')
    .action(withErrors(templatesInitAction));
  templates
    .command('list')
    .description('List templates with their shape + purpose (read from each template’s frontmatter)')
    .addOption(
      new Option('--category <category>', 'template category').choices(['article', 'meta', 'all']).default('article'),
    )
    .option('--json', 'output as JSON')
    .action(withErrors((opts: { json?: boolean; category?: TemplateCategory | 'all' }) => templatesListAction(opts)));

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
  program
    .command('doctor')
    .description('Diagnose configuration issues')
    .option('--fix', 'attempt to repair issues (re-provision plugins, auto-installing missing tools)')
    .action(withErrors((opts: { fix?: boolean }) => doctorAction(opts)));

  // ── lint ──────────────────────────────────────────────────────────────────
  program
    .command('lint')
    .description('Lint articles against the template shapes (frontmatter, budgets, references)')
    .option('-c, --collections <scope>', 'current | all | comma-separated names', 'current')
    .action(withErrors((opts: { collections: string }) => lintAction(opts)));

  return program;
}
