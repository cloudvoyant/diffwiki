#!/usr/bin/env node
// Static site generator. Runs on Node + diffwiki-core + the shipped dist-static
// bundle (no Vite at export time). Emits _data JSON + search-index.json, copies
// client assets, then prerenders every route by driving the built server bundle's
// fetch handler — the same SSR/hydrate path the production bin uses — with an
// on-disk fetch shim so the static-mode loaders resolve _data from `<out>`.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, writeFile, cp, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildNavTree,
  buildCollections,
  resolvePage,
  buildSearchIndex,
  buildLinkGraph,
  listCollections,
  resolveCollectionSelection,
} from 'diffwiki-core';

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};
const outDir = path.resolve(flag('--out', 'dist-site'));
let base = flag('--base', '/');
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;

const splitGlobs = (v) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const filterGlobs = splitGlobs(flag('--filter', ''));
const excludeGlobs = splitGlobs(flag('--exclude', ''));

process.env.DIFFWIKI_STATIC = '1';

const pkgRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// The prebuilt Vite bundle to prerender against. Defaults to the package's
// dist-static; DIFFWIKI_STATIC_DIR lets a caller (e.g. the base-path e2e harness)
// point at a dedicated bundle built with a matching base, without clobbering the
// shared dist-static.
const staticDir = process.env.DIFFWIKI_STATIC_DIR
  ? path.resolve(process.env.DIFFWIKI_STATIC_DIR)
  : path.join(pkgRoot, 'dist-static');
const dataDir = path.join(outDir, '_data');
const baseMarker = path.join(staticDir, '.diffwiki-base');

/**
 * Ensure the static Vite bundle exists AND was built with the requested base. In a
 * workspace (Vite available) it builds/rebuilds as needed so `diffwiki export` uses
 * local packages; a published install ships `dist-static` (base "/") and skips the
 * build. A base marker lets us reuse a cached bundle only when the base matches.
 *
 * CACHING CAVEAT: reuse keys ONLY on the base marker — it does NOT detect source
 * staleness. If you edit app source but keep the same base, a bare
 * `node bin/export.mjs` re-run will reuse the previously built bundle and export
 * stale output. `mise run export` avoids this (its task rebuilds dist-static
 * first); for a direct re-run after source edits, set DIFFWIKI_FORCE_BUILD=1 to
 * force a fresh Vite build.
 */
async function ensureDistStatic() {
  const forceBuild = process.env.DIFFWIKI_FORCE_BUILD === '1';
  const built = await access(path.join(staticDir, 'server', 'server.js'))
    .then(() => true)
    .catch(() => false);
  const builtBase = built ? await readFile(baseMarker, 'utf8').then((s) => s.trim()).catch(() => '/') : null;
  if (built && builtBase === base && !forceBuild) return;
  try {
    console.log(`[diffwiki] building static bundle (base ${base})…`);
    await execFileAsync('pnpm', ['exec', 'vite', 'build', '--outDir', staticDir], {
      cwd: pkgRoot,
      env: { ...process.env, VITE_DIFFWIKI_STATIC: '1', DIFFWIKI_BASE: base },
    });
    await writeFile(baseMarker, base);
  } catch (err) {
    if (built) {
      console.warn(`[diffwiki] could not rebuild dist-static (${err.message}); using the existing bundle — base "${base}" may not match.`);
    } else {
      throw new Error('dist-static is missing and could not be built (needs the workspace + Vite). Run `mise run export`, or build the app first.');
    }
  }
}

// Validate the collection selection UPFRONT — fail before building/generating anything.
const allNames = (await listCollections()).map((c) => c.name);
const selection = resolveCollectionSelection(allNames, { filter: filterGlobs, exclude: excludeGlobs });
if (selection.errors.length > 0) {
  console.error('Export aborted:\n' + selection.errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
const included = new Set(selection.included);
if (filterGlobs.length > 0 || excludeGlobs.length > 0) {
  console.log(`Selecting ${included.size}/${allNames.length} collections: ${selection.included.join(', ')}`);
}

await ensureDistStatic();

// 1. Emit _data + search index (filtered to the selected collections).
await mkdir(dataDir, { recursive: true });
const nav = (await buildNavTree()).filter((ct) => included.has(ct.collection.name));
await writeFile(path.join(dataDir, 'nav-tree.json'), JSON.stringify(nav));
await writeFile(
  path.join(dataDir, 'collections.json'),
  JSON.stringify((await buildCollections()).filter((c) => included.has(c.name))),
);
await writeFile(
  path.join(outDir, 'search-index.json'),
  JSON.stringify((await buildSearchIndex()).filter((d) => included.has(d.collection))),
);
// Whole-wiki knowledge graph, filtered to the selected collections (both endpoints
// of every edge must survive the filter, otherwise the overlay would draw an edge
// to a node that was excluded from the export).
const fullGraph = await buildLinkGraph();
// Keep every surviving article node plus all tag hubs (a tag is not a page, so it
// is never emitted and can never 404); then drop any edge whose endpoints did not
// both survive, and finally prune tag hubs left with no surviving membership edge.
const articleNodes = fullGraph.nodes.filter((n) => n.kind === 'article' && included.has(n.coll));
const survivingIds = new Set([...articleNodes.map((n) => n.id), ...fullGraph.nodes.filter((n) => n.kind === 'tag').map((n) => n.id)]);
const includedEdges = fullGraph.edges.filter((e) => survivingIds.has(e.source) && survivingIds.has(e.target));
const connectedTagIds = new Set(includedEdges.filter((e) => e.kind === 'tag').map((e) => e.target));
const includedNodes = [...articleNodes, ...fullGraph.nodes.filter((n) => n.kind === 'tag' && connectedTagIds.has(n.id))];
await writeFile(path.join(dataDir, 'graph.json'), JSON.stringify({ nodes: includedNodes, edges: includedEdges }));

const routes = new Set(['/']);
const collectPaths = (nodes, acc) => {
  for (const n of nodes) {
    if (n.path) acc.push(n.path);
    if (n.children) collectPaths(n.children, acc);
  }
};
for (const ct of nav) {
  const coll = ct.collection.name;
  routes.add(`/${coll}`);
  await mkdir(path.join(dataDir, 'doc', coll), { recursive: true });
  // Prune each page's sidebar graph preview to the SAME included set as the overlay
  // graph.json above — otherwise a subset export (--filter/--exclude) could preview a
  // neighbour in an excluded collection whose page was never emitted (404 on click).
  await writeFile(path.join(dataDir, 'doc', coll, 'index.json'), JSON.stringify(await resolvePage(coll, '', { include: included })));
  const paths = [];
  collectPaths(ct.nodes, paths);
  for (const p of paths) {
    routes.add(p);
    const slug = p.slice(`/${coll}/`.length);
    const file = path.join(dataDir, 'doc', coll, `${slug}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(await resolvePage(coll, slug, { include: included })));
  }
}

// The /search route is query-driven; prerender its empty shell so the static host
// serves /search/index.html (the client fills results from the index on navigate).
routes.add('/search');

// 2. Copy hashed client assets into the output root.
await cp(path.join(staticDir, 'client'), outDir, { recursive: true });

// 3. Prerender. Shim fetch so static-mode loaders read _data from disk.
const origin = 'http://localhost';
globalThis.__DIFFWIKI_ORIGIN__ = origin;
const realFetch = globalThis.fetch;
const dataMarker = `${base}_data/`;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url, origin);
  if (u.pathname.startsWith(dataMarker)) {
    try {
      const body = await readFile(path.join(dataDir, u.pathname.slice(dataMarker.length)), 'utf8');
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('null', { status: 404 });
    }
  }
  if (u.pathname === `${base}search-index.json`) {
    try {
      const body = await readFile(path.join(outDir, 'search-index.json'), 'utf8');
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('[]', { status: 404 });
    }
  }
  return realFetch(input, init);
};

const { default: serverEntry } = await import(path.join(staticDir, 'server', 'server.js'));
const basePrefix = base.replace(/\/$/, '');
let count = 0;
for (const route of routes) {
  const url = `${origin}${basePrefix}${route === '/' ? '/' : route}`;
  let res = await serverEntry.fetch(new Request(url));
  // Follow one internal redirect — the router normalises some routes (e.g.
  // `/search` → `/search?q=` from search-param defaults), whose 307 body is empty.
  const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  if (location) res = await serverEntry.fetch(new Request(new URL(location, origin).toString()));
  const html = await res.text();
  const rel = route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`;
  const file = path.join(outDir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  count += 1;
}

await writeFile(path.join(outDir, '.nojekyll'), '');
console.log(`Exported ${count} routes to ${outDir}`);
