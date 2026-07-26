import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  CollectionEntry,
  HomeCard,
  ProjectCollection,
  ProjectConfig,
  SiteConfig,
  SiteCopyright,
  SiteHome,
} from './types';

export const PROJECT_CONFIG_FILE = 'diffwiki.yaml';

/** Narrow an unknown YAML `site` block into a validated SiteConfig (or undefined). */
function normaliseSite(raw: unknown): SiteConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  // Note: the diffwiki logo + wordmark are fixed branding (not configurable) — this
  // is a wiki, not a custom site — so `site.title`/`site.logo` are intentionally
  // not read here.
  const repo = typeof r.repo === 'string' ? r.repo : undefined;

  // Footer copyright — a bare string (text only) or { text, url }. No default.
  let copyright: SiteCopyright | undefined;
  if (typeof r.copyright === 'string') {
    copyright = { text: r.copyright };
  } else if (r.copyright && typeof r.copyright === 'object') {
    const c = r.copyright as Record<string, unknown>;
    if (typeof c.text === 'string') {
      copyright = { text: c.text, ...(typeof c.url === 'string' ? { url: c.url } : {}) };
    }
  }

  let home: SiteHome | undefined;
  if (r.home && typeof r.home === 'object') {
    const h = r.home as Record<string, unknown>;
    const tagline = typeof h.tagline === 'string' ? h.tagline : undefined;
    const cards: HomeCard[] = [];
    if (Array.isArray(h.cards)) {
      for (const c of h.cards) {
        if (!c || typeof c !== 'object') continue;
        const cc = c as Record<string, unknown>;
        // A card must at least have a title and a link; icon/subtitle are optional.
        if (typeof cc.title === 'string' && typeof cc.link === 'string') {
          cards.push({
            title: cc.title,
            link: cc.link,
            ...(typeof cc.icon === 'string' ? { icon: cc.icon } : {}),
            ...(typeof cc.subtitle === 'string' ? { subtitle: cc.subtitle } : {}),
          });
        }
      }
    }
    home = { ...(tagline !== undefined ? { tagline } : {}), ...(cards.length > 0 ? { cards } : {}) };
    if (Object.keys(home).length === 0) home = undefined;
  }

  if (repo === undefined && copyright === undefined && home === undefined) return undefined;
  return {
    ...(repo !== undefined ? { repo } : {}),
    ...(copyright !== undefined ? { copyright } : {}),
    ...(home !== undefined ? { home } : {}),
  };
}

/**
 * Read and normalise the repo-root `diffwiki.yaml`. Supports the extended form
 * ({ site, collections[] }) AND the legacy single-collection form
 * ({ collection, path }), folded into a one-element `collections`. Returns
 * undefined when the file is absent (ENOENT); parse/other read errors propagate.
 */
export async function readProjectConfig(dir: string): Promise<ProjectConfig | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, PROJECT_CONFIG_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const collections: ProjectCollection[] = [];
  if (Array.isArray(parsed.collections)) {
    for (const c of parsed.collections) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      if (typeof cc.name === 'string' && typeof cc.path === 'string') {
        collections.push({
          name: cc.name,
          path: cc.path,
          ...(typeof cc.order === 'number' ? { order: cc.order } : {}),
        });
      }
    }
    // Display order: stable sort by explicit `order` (ascending). Entries without
    // `order` sort after ordered ones; `Array.prototype.sort` is stable, so ties —
    // including all-unset — preserve diffwiki.yaml list order. This is the single
    // normalization point, so every consumer (registry seed, nav, home, search)
    // inherits the order with no downstream sorting.
    collections.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
  } else if (typeof parsed.path === 'string') {
    // Legacy: { collection?, path } → one collection (name defaults to dir name).
    const name = typeof parsed.collection === 'string' ? parsed.collection : path.basename(path.resolve(dir));
    collections.push({ name, path: parsed.path });
  }

  const site = normaliseSite(parsed.site);
  return { ...(site ? { site } : {}), collections };
}

/**
 * Resolve `diffwiki.yaml` collections into registry-shaped CollectionEntry[] with
 * absolute paths (relative to the project root). Empty when no config / no
 * collections. Used to seed an ephemeral registry for `preview` and the CI build.
 */
export async function resolveProjectCollections(dir: string): Promise<CollectionEntry[]> {
  const config = await readProjectConfig(dir);
  if (!config) return [];
  const root = path.resolve(dir);
  const createdAt = new Date().toISOString();
  return config.collections.map((c) => ({
    name: c.name,
    type: 'repo' as const,
    path: path.resolve(root, c.path),
    createdAt,
  }));
}

/** The site block from `diffwiki.yaml`, or `{}` when absent. */
export async function readSiteConfig(dir: string): Promise<SiteConfig> {
  return (await readProjectConfig(dir))?.site ?? {};
}

/**
 * Create a throwaway DIFFWIKI_HOME seeded with a registry built from the project's
 * diffwiki.yaml collections, and return its path + the resolved entries. This is the single mechanism
 * both `diffwiki preview` and `diffwiki export --project` use to render a repo's
 * own wiki without touching the global registry: seed a tmp home, point
 * DIFFWIKI_HOME at it on the fly, and every downstream reader (listCollections,
 * buildNavTree, buildSiteConfig) works unchanged. Throws when the config is missing or
 * declares no collections. Callers own cleanup (`fs.rm(home, …)`).
 */
export async function seedProjectHome(dir: string): Promise<{ home: string; entries: CollectionEntry[] }> {
  const entries = await resolveProjectCollections(dir);
  if (entries.length === 0) {
    throw new Error(`No collections to render from diffwiki.yaml in ${path.resolve(dir)}`);
  }
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'diffwiki-project-'));
  await fs.writeFile(
    path.join(home, 'registry.json'),
    `${JSON.stringify({ version: 1, collections: entries }, null, 2)}\n`,
    'utf8',
  );
  return { home, entries };
}
